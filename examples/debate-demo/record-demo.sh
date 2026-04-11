#!/usr/bin/env bash
# VHS recording script — staged output with full visual treatment.
# For a live run: npm run demo:live "AI will replace software engineers"

# ── colors ───────────────────────────────────────────────────────────────────
RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[96m"
YELLOW="\033[93m"
GREEN="\033[92m"
MAGENTA="\033[95m"
WHITE="\033[97m"
GRAY="\033[90m"
BG_CYAN="\033[48;5;23m"
BG_YELLOW="\033[48;5;58m"

W=60  # inner box width

# ── helpers ──────────────────────────────────────────────────────────────────
hline() { printf "${DIM}%0.s─${RESET}" $(seq 1 62); echo; }

# top/bottom border of a box
box_top()    { local label="$1" col="$2"; echo -e "${col}╭─ ${BOLD}${label}${RESET}${col} $(printf '%0.s─' $(seq 1 $((W - ${#label} - 1))))╮${RESET}"; }
box_bottom() { local col="$1"; echo -e "${col}╰$(printf '%0.s─' $(seq 1 $((W + 2))))╯${RESET}"; }
box_line()   { local text="$1" col="$2"
  local pad=$(( W - ${#text} ))
  echo -e "${col}│${RESET}  ${text}$(printf '%*s' $pad '')${col}  │${RESET}"; }
box_blank()  { local col="$1"; echo -e "${col}│$(printf '%*s' $((W + 2)) '')│${RESET}"; }

# envelope arrow
envelope() {
  echo
  echo -e "         ${GRAY}╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌${RESET}"
  echo -e "         ${MAGENTA}${BOLD}  ✉  signed SAMVAD envelope  ·  Ed25519  →${RESET}"
  echo -e "         ${GRAY}╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌${RESET}"
  echo
}

# wrap text to W chars, return as array in WRAPPED
wrap_text() {
  local text="$1" line="" word
  WRAPPED=()
  for word in $text; do
    if [ $(( ${#line} + ${#word} + 1 )) -gt $W ]; then
      WRAPPED+=("$line"); line="$word"
    else
      [ -n "$line" ] && line="$line $word" || line="$word"
    fi
  done
  [ -n "$line" ] && WRAPPED+=("$line")
}

researcher_box() {
  local text="$1"
  wrap_text "$text"
  box_top "RESEARCHER" "${CYAN}"
  box_blank "${CYAN}"
  for line in "${WRAPPED[@]}"; do box_line "$line" "${CYAN}"; done
  box_blank "${CYAN}"
  box_bottom "${CYAN}"
}

redteam_box() {
  local text="$1"
  wrap_text "$text"
  box_top "RED TEAM" "${YELLOW}"
  box_blank "${YELLOW}"
  for line in "${WRAPPED[@]}"; do box_line "$line" "${YELLOW}"; done
  box_blank "${YELLOW}"
  box_bottom "${YELLOW}"
}

# ── HEADER ───────────────────────────────────────────────────────────────────
clear
echo
echo -e "${CYAN}${BOLD}  ███████╗ █████╗ ███╗   ███╗██╗   ██╗ █████╗ ██████╗${RESET}"
echo -e "${CYAN}${BOLD}  ██╔════╝██╔══██╗████╗ ████║██║   ██║██╔══██╗██╔══██╗${RESET}"
echo -e "${CYAN}${BOLD}  ███████╗███████║██╔████╔██║██║   ██║███████║██║  ██║${RESET}"
echo -e "${CYAN}${BOLD}  ╚════██║██╔══██║██║╚██╔╝██║╚██╗ ██╔╝██╔══██║██║  ██║${RESET}"
echo -e "${CYAN}${BOLD}  ███████║██║  ██║██║ ╚═╝ ██║ ╚████╔╝ ██║  ██║██████╔╝${RESET}"
echo -e "${CYAN}${BOLD}  ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═════╝${RESET}"
echo
echo -e "  ${DIM}signed · rate-limited · agent-to-agent messaging in 15 lines${RESET}"
echo
sleep 1.0

hline
echo -e "  ${WHITE}Topic   ${RESET}\"AI will replace software engineers\""
echo -e "  ${CYAN}Agent 1 ${RESET}Research Assistant  ${GRAY}→ localhost:3010${RESET}"
echo -e "  ${YELLOW}Agent 2 ${RESET}Red Team Agent      ${GRAY}→ localhost:3011${RESET}"
echo -e "  ${MAGENTA}Signing ${RESET}Ed25519 · RFC 9421 · nonce replay protection"
hline
echo
sleep 0.8

echo -e "  ${GRAY}[1/4]${RESET} booting agents..."
sleep 0.4
echo -e "  ${GREEN}[✓]${RESET} Red Team Agent    ${GRAY}http://localhost:3011${RESET}"
sleep 0.2
echo -e "  ${GREEN}[✓]${RESET} Research Assistant ${GRAY}http://localhost:3010${RESET}"
sleep 0.3
echo -e "  ${GREEN}[✓]${RESET} trust established  ${GRAY}researcher-outbound ↔ red-team${RESET}"
sleep 0.3
echo -e "  ${GREEN}[✓]${RESET} runner connected   ${GRAY}agent://runner.local → researcher${RESET}"
echo
sleep 0.8

# ── CLAIM 1 ──────────────────────────────────────────────────────────────────
hline
echo -e "  ${BOLD}${WHITE}CLAIM 1 / 3${RESET}"
hline
echo
sleep 0.5

researcher_box "AI systems already outperform humans on standardised coding benchmarks."
sleep 0.6

envelope
sleep 0.5

redteam_box "Benchmark performance ≠ production engineering. Real work involves ambiguity, legacy systems, and stakeholder politics that benchmarks cannot model."
echo
sleep 1.2

# ── CLAIM 2 ──────────────────────────────────────────────────────────────────
hline
echo -e "  ${BOLD}${WHITE}CLAIM 2 / 3${RESET}"
hline
echo
sleep 0.5

researcher_box "The cost of AI-generated code is falling 40% year-over-year."
sleep 0.6

envelope
sleep 0.5

redteam_box "Jevons Paradox: cheaper code generation historically increases total software demand — expanding the market rather than shrinking it."
echo
sleep 1.2

# ── CLAIM 3 ──────────────────────────────────────────────────────────────────
hline
echo -e "  ${BOLD}${WHITE}CLAIM 3 / 3${RESET}"
hline
echo
sleep 0.5

researcher_box "Early adopters report 30-50% productivity gains on well-scoped tasks."
sleep 0.6

envelope
sleep 0.5

redteam_box '"Well-scoped" excludes the hardest parts of engineering. Self-reported gains on cherry-picked tasks do not generalise to production systems.'
echo
sleep 1.2

# ── VERDICT ──────────────────────────────────────────────────────────────────
hline
echo -e "  ${BOLD}${WHITE}VERDICT${RESET}"
hline
echo
sleep 0.6

echo -e "  Reliability  ${YELLOW}${BOLD}● MEDIUM${RESET}"
echo
sleep 0.4
echo -e "  ${DIM}Claims are directionally plausible but consistently pick the${RESET}"
echo -e "  ${DIM}easiest cases. Legacy code, ambiguous requirements, and system${RESET}"
echo -e "  ${DIM}design remain entirely unaddressed.${RESET}"
echo
sleep 0.8

hline
echo -e "  ${GRAY}traceId  a3f82c11-7d4e-4b9a-9e21-8fc3120d6a47${RESET}"
echo -e "  ${GREEN}${BOLD}✓ 4 SAMVAD envelopes exchanged · all Ed25519-signed${RESET}"
hline
echo
