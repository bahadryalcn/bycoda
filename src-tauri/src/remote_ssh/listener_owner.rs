//! Which process listens on a local tunnel port. The port is reserved by binding
//! and releasing it, so another process can take it before ssh binds it. A
//! successful connect proves only that something answers, so a tunnel is trusted
//! only when the one listener on its port belongs to the ssh process it started.

/// The owners of the TCP listeners on a local port. `None` where this platform
/// cannot list listeners; the caller then relies on ssh's own exit status.
#[cfg(windows)]
pub(super) fn listener_owners(port: u16) -> Result<Option<Vec<u32>>, String> {
    table::listener_owners(port).map(Some)
}

#[cfg(not(windows))]
pub(super) fn listener_owners(_port: u16) -> Result<Option<Vec<u32>>, String> {
    Ok(None)
}

pub(super) const PORT_TAKEN: &str = "The local port for the SSH tunnel is held by another process, so the tunnel was not trusted. Try again.";

/// `Ok(true)` when `ssh_pid` is the only listener, `Ok(false)` while nothing
/// listens yet, and an error for any other listener: fail closed.
pub(super) fn ssh_owns_port(owners: &[u32], ssh_pid: u32) -> Result<bool, String> {
    match owners {
        [] => Ok(false),
        [owner] if *owner == ssh_pid => Ok(true),
        _ => Err(PORT_TAKEN.into()),
    }
}

#[cfg(windows)]
mod table {
    use windows_sys::Win32::{
        Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
            TCP_TABLE_OWNER_PID_LISTENER,
        },
        Networking::WinSock::AF_INET,
    };

    pub(super) fn listener_owners(port: u16) -> Result<Vec<u32>, String> {
        let mut size = 0u32;
        let mut buffer: Vec<u64> = Vec::new();
        // The table can grow between the size query and the read, so retry a few times.
        for _ in 0..3 {
            let status = unsafe {
                GetExtendedTcpTable(
                    buffer.as_mut_ptr().cast(),
                    &mut size,
                    0,
                    AF_INET as u32,
                    TCP_TABLE_OWNER_PID_LISTENER,
                    0,
                )
            };
            if status == NO_ERROR {
                return Ok(owners_on_port(&buffer, port));
            }
            if status != ERROR_INSUFFICIENT_BUFFER {
                return Err(format!("Could not read the local TCP listeners ({status})."));
            }
            // u64 storage keeps the table aligned for its row structs.
            buffer = vec![0; (size as usize).div_ceil(8)];
        }
        Err("Could not read the local TCP listeners: the table kept growing.".into())
    }

    fn owners_on_port(buffer: &[u64], port: u16) -> Vec<u32> {
        if buffer.len() * 8 < std::mem::size_of::<MIB_TCPTABLE_OWNER_PID>() {
            return Vec::new();
        }
        let header = buffer.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>();
        // SAFETY: GetExtendedTcpTable wrote a table of this layout into `buffer`,
        // which holds the header; its rows follow it. The rows are read through a
        // pointer to the first one, since the declared row array has length one.
        unsafe {
            let count = (*header).dwNumEntries as usize;
            let first = std::ptr::addr_of!((*header).table).cast::<MIB_TCPROW_OWNER_PID>();
            std::slice::from_raw_parts(first, count)
                .iter()
                // The port sits in the low 16 bits, in network byte order.
                .filter(|row| u16::from_be((row.dwLocalPort & 0xffff) as u16) == port)
                .map(|row| row.dwOwningPid)
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_is_trusted_only_for_its_own_ssh_listener() {
        assert_eq!(ssh_owns_port(&[], 40), Ok(false));
        assert_eq!(ssh_owns_port(&[40], 40), Ok(true));
    }

    #[test]
    fn foreign_or_ambiguous_listeners_fail_closed() {
        assert_eq!(ssh_owns_port(&[77], 40), Err(PORT_TAKEN.into()));
        assert_eq!(ssh_owns_port(&[40, 77], 40), Err(PORT_TAKEN.into()));
        assert_eq!(ssh_owns_port(&[77, 40], 40), Err(PORT_TAKEN.into()));
        assert_eq!(ssh_owns_port(&[77, 77], 40), Err(PORT_TAKEN.into()));
    }
}
