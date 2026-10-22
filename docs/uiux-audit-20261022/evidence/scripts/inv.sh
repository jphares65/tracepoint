#!/bin/bash
S=$1   # src dir
A=$S/app
g(){ grep -rnE "$1" $A --include=*.tsx --exclude-dir=api 2>/dev/null; }
echo "shell usages: $(grep -rn '<TracePointShell' --include=*.tsx $A | wc -l) in $(grep -rln '<TracePointShell' --include=*.tsx $A | wc -l) files"
echo "fixed inset-0: $(g 'fixed inset-0' | wc -l) in $(g 'fixed inset-0' | cut -d: -f1 | sort -u | wc -l) files"
echo "role=dialog/alertdialog/aria-modal: $(g 'role="dialog"|role="alertdialog"|aria-modal' | wc -l)"
echo "Escape files: $(grep -rlE '"Escape"' $A --include=*.tsx | wc -l)"
echo "createPortal: $(g 'createPortal' | wc -l)"
echo "body scroll lock: $(g 'document.body.style' | wc -l)"
echo "autoFocus/.focus(): $(g 'autoFocus|\.focus\(' | wc -l)"
for k in confirm alert prompt; do echo "window.$k: $(g "window\.$k\(" | wc -l) in $(g "window\.$k\(" | cut -d: -f1 | sort -u | wc -l) files"; done
echo "bare confirm(/alert(/prompt( not window.: $(g '(^|[^.a-zA-Z])(confirm|alert|prompt)\(' | grep -v 'window\.' | wc -l)"
echo "toast mentions: $(grep -rniE 'toast' $A --include=*.tsx | wc -l)"
echo "message-state files: $(grep -rlE 'const \[(notice|success|message|banner|flash|toast)[A-Za-z]*, set' $A --include=*.tsx | wc -l)"
echo "fixed bottom toasts: $(g 'fixed bottom-' | wc -l)"
echo "beforeunload: $(grep -rn beforeunload $A | wc -l)"
echo "bg-blue-600 distinct className: $(grep -rhoE 'className="[^"]*bg-blue-600[^"]*"' $A --include=*.tsx --exclude-dir=api | sort -u | wc -l)"
echo "px sizes total: $(grep -rhoE 'text-\[[0-9.]+px\]' $A --include=*.tsx --exclude-dir=api | wc -l) files: $(grep -rlE 'text-\[[0-9.]+px\]' $A --include=*.tsx --exclude-dir=api | wc -l)"
grep -rhoE 'text-\[[0-9.]+px\]' $A --include=*.tsx --exclude-dir=api | sort | uniq -c | sort -k2 | tr '\n' ' '; echo
echo "<=10px: $(grep -rhoE 'text-\[(8|9|10)px\]' $A --include=*.tsx --exclude-dir=api | wc -l)"
echo "text-sm: $(grep -rhoE '\btext-sm\b' $A --include=*.tsx --exclude-dir=api | wc -l) text-xs: $(grep -rhoE '\btext-xs\b' $A --include=*.tsx --exclude-dir=api | wc -l)"
echo "h1: $(grep -rhoE '<h1[^>]*' $A --include=*.tsx --exclude-dir=api | wc -l) distinct class: $(grep -rhoE '<h1[^>]*className="[^"]*"' $A --include=*.tsx --exclude-dir=api | sort -u | wc -l)"
echo "status maps: $(g 'function (status|tone|severity|getStatus|getSeverity)[A-Za-z]*(Class|Classes|Tone|Style|Styles)\b|const (STATUS|TONE)_[A-Z_]* *[:=]|const (toneClasses|statusClasses|STATUS_STYLES|STATUS_CLASS|STATUS_STYLE)\b' | wc -l)"
g 'function (status|tone|severity|getStatus|getSeverity)[A-Za-z]*(Class|Classes|Tone|Style|Styles)\b|const (STATUS|TONE)_[A-Z_]* *[:=]|const (toneClasses|statusClasses|STATUS_STYLES|STATUS_CLASS|STATUS_STYLE)\b' | sed "s|$A/||" | cut -c1-120
echo "pill/badge components: $(g 'function [A-Za-z]*(Pill|Badge|Chip)\b' | wc -l)"
g 'function [A-Za-z]*(Pill|Badge|Chip)\b' | sed "s|$A/||" | cut -c1-120
echo "backup files src: $(find $S -name '*.backup-*' | wc -l) (api: $(find $S -path '*api*' -name '*.backup-*' | wc -l)); .bak: $(find $S -name '*.bak' | wc -l); .before-*: $(find $S -name '*.before-*' | wc -l)"
echo "hex: $(grep -rnoE '#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b' $A --include=*.tsx --exclude-dir=api | wc -l) rgb: $(grep -rnoE 'rgba?\([0-9]' $A --include=*.tsx --exclude-dir=api | wc -l) dark: $(grep -rnoE '\bdark:[a-z]' $A --include=*.tsx --exclude-dir=api | wc -l) bg-white: $(grep -rnoE '\bbg-white\b' $A --include=*.tsx --exclude-dir=api | wc -l)"
echo "tables: $(g '<table' | wc -l) in $(g '<table' | cut -d: -f1 | sort -u | wc -l) files; min-w-[NNNpx]: $(g 'min-w-\[[0-9]{3,4}px\]' | wc -l)"
echo "text-emerald: $(grep -rhoE '\btext-emerald-[0-9]+' $A --include=*.tsx | wc -l)"
echo "tsx files: $(find $A -name '*.tsx' -not -path '*/api/*' | wc -l)"
