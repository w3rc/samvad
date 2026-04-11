# SAMVAD debate demo — two agents, Ed25519-signed envelopes
# Output: demo.gif (for README embed)
#
# Live mode: OPENROUTER_API_KEY=... GROQ_API_KEY=... npm run demo:live "AI will..."
# Record:    cd examples/debate-demo && vhs demo.tape

Output demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1000
Set Height 720
Set Theme "Dracula"
Set TypingSpeed 50ms
Set Padding 24

Env PATH "/home/silverion/.local/bin:/home/silverion/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"

Sleep 800ms
Type `npm run demo "AI will replace software engineers"`
Enter

# record-demo.sh runs for ~14s with staged pauses; add buffer
Sleep 18000ms
