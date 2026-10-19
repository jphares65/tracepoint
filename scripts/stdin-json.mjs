// Windows PowerShell 5.1 prefixes text piped to a native command with a UTF-8 byte order mark
// when $OutputEncoding is UTF-8, which JSON.parse rejects. Only a single leading BOM is removed.
export function stripByteOrderMark(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
