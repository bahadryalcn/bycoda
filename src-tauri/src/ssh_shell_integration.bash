# Session-only opt-in. No dotfile mutation, package install or input logging.
if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 4) )); then
    printf '\033]777;bycoda;__BYCODA_NONCE__;unavailable\007'
else
    [[ -r "$HOME/.bashrc" ]] && source "$HOME/.bashrc"
    __bycoda_user=$(id -un)
    __bycoda_host=$(hostname)
    __bycoda_prompt_seq=0
    __bycoda_request_seq=0
    __bycoda_prompt_echo_ok=0
    __bycoda_emit() { printf '\033]777;bycoda;__BYCODA_NONCE__;%s\007' "$1"; }
    __bycoda_unavailable() { __bycoda_emit "unavailable;$__bycoda_prompt_seq;$__bycoda_request_seq"; }
    __bycoda_no_match() { __bycoda_emit "no-match;$__bycoda_prompt_seq;$__bycoda_request_seq"; }
    __bycoda_busy() { __bycoda_emit "busy;$__bycoda_prompt_seq;$__bycoda_request_seq"; }
    __bycoda_echo() {
        local mode
        mode=$(stty -a 2>/dev/null) || return 1
        mode=${mode//$'\n'/ }
        mode=${mode//;/ }
        [[ " $mode " != *" -echo "* ]]
    }
    __bycoda_prompt() {
        local __bycoda_exit=$?
        (( ++__bycoda_prompt_seq ))
        if __bycoda_echo; then
            __bycoda_prompt_echo_ok=1
            __bycoda_emit "ready;$__bycoda_user;$__bycoda_host;$__bycoda_prompt_seq;$__bycoda_request_seq"
        else
            __bycoda_prompt_echo_ok=0
            __bycoda_unavailable
        fi
        return "$__bycoda_exit"
    }
    __bycoda_literal() {
        [[ ${#1} -le 256 && $1 != *[!a-zA-Z0-9\ ./_:-]* ]] || return 1
        local lower=${1,,}
        [[ $lower != *password* && $lower != *passwd* && $lower != *secret* && $lower != *token* && $lower != *authorization* && $lower != *api_key* && $lower != *apikey* && $lower != *credential* && $lower != *.env* && $lower != *.ssh* && $lower != *private* ]]
    }
    __bycoda_reviewed() {
        __bycoda_literal "$1" || return 1
        case $1 in
            cd|ls|pwd|git|docker|systemctl|'ls -l'|'ls -la'|'git status'|'git diff'|'git log --oneline'|'docker ps'|'docker ps -a'|'systemctl status') return 0 ;;
        esac
        [[ $1 =~ ^(cd|ls)\ [a-zA-Z0-9./_:][a-zA-Z0-9./_:-]*$ || $1 =~ ^systemctl\ status\ [a-zA-Z0-9./_:][a-zA-Z0-9./_:-]*$ ]]
    }
    __bycoda_source() {
        local source=$1 candidate values='' path lead count=0 i
        local -a recent
        (( ++__bycoda_request_seq ))
        [[ $__bycoda_prompt_echo_ok == 1 ]] || { __bycoda_unavailable; return; }
        [[ $READLINE_POINT == ${#READLINE_LINE} ]] && __bycoda_literal "$READLINE_LINE" || { __bycoda_no_match; return; }
        # Enumeration uses only shell builtins. Never invoke programmable
        # completion, expand shell syntax, read file contents or execute a name.
        case $source in
            commands)
                # Recent matching history comes first, followed by common forms
                # and executable names. No programmable completion is invoked.
                mapfile -t recent < <(HISTTIMEFORMAT= builtin history 200 2>/dev/null)
                for (( i=${#recent[@]}-1; i>=0; i-- )); do
                    candidate=${recent[i]#*[0-9]  }
                    __bycoda_literal "$candidate" && [[ -n $candidate && $candidate != ' '* && $candidate != "$READLINE_LINE" && $candidate == "$READLINE_LINE"* && $values != *"$candidate"$'\t'* ]] || continue
                    values+="$candidate"$'\t'; (( ++count >= 8 )) && break
                done
                for candidate in 'git status' 'git diff' 'git diff --staged' 'git log --oneline' 'git stash list' 'ls -l' 'ls -la' 'docker ps' 'docker ps -a' 'docker compose up' 'docker compose logs -f' 'systemctl status' 'systemctl restart' 'pnpm install' 'pnpm dev' 'pnpm build' 'pnpm test' 'npm install' 'npm run dev' 'cargo check' 'cargo test' 'clear'; do
                    [[ $candidate != "$READLINE_LINE" && $candidate == "$READLINE_LINE"* && $values != *"$candidate"$'\t'* ]] && builtin type -t -- "${candidate%% *}" >/dev/null 2>&1 && values+="$candidate"$'\t'
                done
                while IFS= read -r candidate; do
                    __bycoda_literal "$candidate" && [[ $candidate != "$READLINE_LINE" && $candidate != *[\ /]* && $candidate != -* && $values != *"$candidate"$'\t'* ]] || continue
                    values+="$candidate"$'\t'; (( ++count >= 12 )) && break
                done < <(builtin compgen -A command -- "$READLINE_LINE") ;;
            paths)
                case $READLINE_LINE in 'cd '*|'ls '*) ;; *) __bycoda_no_match; return ;; esac
                lead=${READLINE_LINE%% *}' '; path=${READLINE_LINE#* }
                [[ $path != -* && $path != *' '* ]] || { __bycoda_no_match; return; }
                while IFS= read -r candidate; do
                    [[ $READLINE_LINE != 'cd '* || -d $candidate ]] || continue
                    [[ ! -d $candidate ]] || candidate+=/
                    __bycoda_reviewed "$lead$candidate" || continue
                    values+="$lead$candidate"$'\t'; (( ++count >= 12 )) && break
                done < <(builtin compgen -f -- "$path") ;;
            reviewed)
                while IFS= read -r candidate; do
                    candidate=${candidate#*[0-9]  }
                    case $candidate in cd|git|ls|'ls -l'|'ls -la'|pwd|'git status'|'git diff'|'git log --oneline') ;; *) continue ;; esac
                    [[ $candidate == "$READLINE_LINE"* && $values != *"$candidate"$'\t'* ]] && builtin type -t -- "${candidate%% *}" >/dev/null 2>&1 && values+="$candidate"$'\t'
                done < <(HISTTIMEFORMAT= builtin history 100 2>/dev/null)
                for candidate in cd git ls 'ls -l' 'ls -la' pwd 'git status' 'git diff' 'git log --oneline'; do
                    [[ $candidate == "$READLINE_LINE"* && $values != *"$candidate"$'\t'* ]] && builtin type -t -- "${candidate%% *}" >/dev/null 2>&1 && values+="$candidate"$'\t'
                done ;;
            history)
                mapfile -t recent < <(HISTTIMEFORMAT= builtin history 200 2>/dev/null)
                for (( i=${#recent[@]}-1; i>=0; i-- )); do
                    candidate=${recent[i]#*[0-9]  }
                    __bycoda_literal "$candidate" && [[ -n $candidate && $candidate != ' '* && $candidate != "$READLINE_LINE" && $candidate == "$READLINE_LINE"* && $values != *"$candidate"$'\t'* ]] || continue
                    values+="$candidate"$'\t'; (( ++count >= 12 )) && break
                done ;;
        esac
        [[ -n $values ]] || { __bycoda_no_match; return; }
        __bycoda_emit "suggestions;$__bycoda_user;$__bycoda_host;$__bycoda_prompt_seq;$__bycoda_request_seq;$READLINE_POINT;$READLINE_LINE;$values"
    }
    __bycoda_request() { __bycoda_source reviewed; }
    bind -x '"\C-x\C-g":__bycoda_request'
    bind -x '"\C-x\C-k":__bycoda_source commands'
    bind -x '"\C-x\C-p":__bycoda_source paths'
    bind -x '"\C-x\C-y":__bycoda_source history'
    bind 'set enable-bracketed-paste on'
    PS0='$(__bycoda_busy)'"$PS0"
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )) && [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a '* ]]; then
        PROMPT_COMMAND+=(__bycoda_prompt)
    elif [[ -z ${PROMPT_COMMAND-} ]]; then
        PROMPT_COMMAND=__bycoda_prompt
    else
        PROMPT_COMMAND="$PROMPT_COMMAND"$'\n''__bycoda_prompt'
    fi
fi
