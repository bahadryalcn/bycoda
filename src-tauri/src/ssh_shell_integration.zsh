# Explicit new-session integration. Only the uniquely-owned temporary ZDOTDIR
# contains this rc. Restore the user's original config directory before reading
# their normal rc; no user dotfiles or history settings are changed.
if [[ ${BYCODA_ZDOTDIR_SET-} == x ]]; then
    ZDOTDIR=$BYCODA_ZDOTDIR_ORIGINAL
else
    unset ZDOTDIR
fi
unset BYCODA_ZDOTDIR_SET BYCODA_ZDOTDIR_ORIGINAL
[[ -r ${ZDOTDIR-$HOME}/.zshrc ]] && source "${ZDOTDIR-$HOME}/.zshrc"

__bycoda_user=$(id -un)
__bycoda_host=$(hostname)
typeset -gi __bycoda_prompt_seq=0 __bycoda_request_seq=0 __bycoda_prompt_echo_ok=0
__bycoda_emit() { printf '\033]777;bycoda;__BYCODA_NONCE__;%s\007' "$1"; }
__bycoda_unavailable() { __bycoda_emit "unavailable;$__bycoda_prompt_seq;$__bycoda_request_seq"; }
__bycoda_no_match() { __bycoda_emit "no-match;$__bycoda_prompt_seq;$__bycoda_request_seq"; }
__bycoda_echo() {
    emulate -L zsh
    local mode
    mode=$(stty -a 2>/dev/null) || return 1
    mode=${mode//$'\n'/ }
    mode=${mode//;/ }
    [[ " $mode " != *" -echo "* ]]
}
__bycoda_prompt() {
    local __bycoda_exit=$?
    emulate -L zsh
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
__bycoda_busy() {
    __bycoda_prompt_echo_ok=0
    __bycoda_emit "busy;$__bycoda_prompt_seq;$__bycoda_request_seq"
}
autoload -Uz add-zsh-hook
__bycoda_literal() {
    emulate -L zsh
    [[ ${#1} -le 256 && $1 != *[^a-zA-Z0-9\ ./_:-]* ]] || return 1
    local lower=${(L)1}
    [[ $lower != *password* && $lower != *passwd* && $lower != *secret* && $lower != *token* && $lower != *credential* && $lower != *.env* && $lower != *.ssh* && $lower != *private* ]]
}
__bycoda_reviewed() {
    emulate -L zsh
    __bycoda_literal "$1" || return 1
    case $1 in
        cd|ls|pwd|git|docker|systemctl|'ls -l'|'ls -la'|'git status'|'git diff'|'git log --oneline'|'docker ps'|'docker ps -a'|'systemctl status') return 0 ;;
    esac
    [[ $1 =~ '^(cd|ls) [a-zA-Z0-9./_:][a-zA-Z0-9./_:-]*$' || $1 =~ '^systemctl status [a-zA-Z0-9./_:][a-zA-Z0-9./_:-]*$' ]]
}
__bycoda_source() {
    emulate -L zsh
    local source=$1 candidate values='' typed_path lead count=0
    local -a candidates
    (( ++__bycoda_request_seq ))
    [[ $__bycoda_prompt_echo_ok == 1 ]] || { __bycoda_unavailable; return; }
    [[ $CURSOR == ${#BUFFER} ]] && __bycoda_literal "$BUFFER" || { __bycoda_no_match; return; }
    case $source in
        commands)
            [[ $BUFFER != */* && $BUFFER != -* ]] || { __bycoda_no_match; return; }
            # Parameter-table keys enumerate names without invoking/autoloading
            # functions or calling the user's programmable completion widgets.
            builtin rehash
            candidates=( ${(k)commands} ${(k)builtins} ${(k)functions} ${(k)aliases} 'git status' 'git diff' 'git log --oneline' 'ls -l' 'ls -la' 'docker ps' 'docker ps -a' 'systemctl status' ) ;;
        paths)
            case $BUFFER in 'cd '*|'ls '*) ;; *) __bycoda_no_match; return ;; esac
            lead=${BUFFER%% *}' '; typed_path=${BUFFER#* }
            [[ $typed_path != -* && $typed_path != *' '* ]] || { __bycoda_no_match; return; }
            candidates=( ${~typed_path}*(N) ) ;;
        reviewed) candidates=( "${(@f)$(builtin fc -ln -100 2>/dev/null)}" cd git ls 'ls -l' 'ls -la' pwd 'git status' 'git diff' 'git log --oneline' ) ;;
        history) candidates=( "${(@f)$(builtin fc -ln -100 2>/dev/null)}" ) ;;
    esac
    for candidate in "${candidates[@]}"; do
        if [[ $source == paths ]]; then
            [[ $BUFFER != 'cd '* || -d $candidate ]] || continue
            [[ ! -d $candidate ]] || candidate+=/
            candidate=$lead$candidate
            __bycoda_reviewed "$candidate" || continue
        elif [[ $source == commands ]]; then
            [[ $candidate != */* && $candidate != -* ]] || continue
            if [[ $candidate == *' '* ]]; then
                __bycoda_reviewed "$candidate" || continue
                builtin whence -w -- "${candidate%% *}" >/dev/null 2>&1 || continue
            fi
        else
            if [[ $source == reviewed ]]; then
                case $candidate in cd|git|ls|'ls -l'|'ls -la'|pwd|'git status'|'git diff'|'git log --oneline') ;; *) continue ;; esac
            else
                __bycoda_reviewed "$candidate" || continue
            fi
            builtin whence -w -- "${candidate%% *}" >/dev/null 2>&1 || continue
        fi
        __bycoda_literal "$candidate" && [[ $candidate == "$BUFFER"* && $values != *"$candidate"$'\t'* ]] || continue
        values+="$candidate"$'\t'
        (( ++count >= 12 )) && break
    done
    [[ -n $values ]] || { __bycoda_no_match; return; }
    __bycoda_emit "suggestions;$__bycoda_user;$__bycoda_host;$__bycoda_prompt_seq;$__bycoda_request_seq;$CURSOR;$BUFFER;$values"
    zle -R
}
__bycoda_request() { __bycoda_source reviewed; }
__bycoda_commands() { __bycoda_source commands; }
__bycoda_paths() { __bycoda_source paths; }
__bycoda_history() { __bycoda_source history; }
zle -N __bycoda_commands
zle -N __bycoda_paths
zle -N __bycoda_history
for __bycoda_map in main emacs viins; do
    bindkey -M $__bycoda_map '^X^K' __bycoda_commands
    bindkey -M $__bycoda_map '^X^P' __bycoda_paths
    bindkey -M $__bycoda_map '^X^Y' __bycoda_history
done
unset __bycoda_map
add-zsh-hook precmd __bycoda_prompt
add-zsh-hook preexec __bycoda_busy
zle -N __bycoda_request
bindkey '^X^G' __bycoda_request
bindkey -M emacs '^X^G' __bycoda_request
bindkey -M viins '^X^G' __bycoda_request
bindkey '^[[200~' bracketed-paste
bindkey -M emacs '^[[200~' bracketed-paste
bindkey -M viins '^[[200~' bracketed-paste
