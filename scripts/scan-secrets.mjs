// Lightweight secret scan over tracked files. CI also runs gitleaks; this catches the obvious
// cases locally without extra tooling. Exits non-zero on any finding.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  ["Anthropic API key", /sk-ant-[a-zA-Z0-9_-]{20,}/],
  ["OpenAI API key", /sk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["Stripe secret key", /sk_live_[0-9a-zA-Z]{24,}/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Slack token", /xox[baprs]-[0-9A-Za-z-]{10,}/],
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
let findings = 0;
for (const file of files) {
  if (/\.(png|jpe?g|gif|woff2?|ico)$/i.test(file) || file.endsWith("package-lock.json")) continue;
  const text = readFileSync(file, "utf8");
  for (const [name, re] of PATTERNS) {
    if (re.test(text)) {
      console.error(`${file}: possible ${name}`);
      findings++;
    }
  }
}
console.log(findings === 0 ? `Secret scan: ${files.length} files, no findings.` : `Secret scan: ${findings} finding(s).`);
process.exit(findings === 0 ? 0 : 1);
