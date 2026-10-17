// Every test file runs in its own scratch dir (data/ lands there) against a
// copy of vault-template — never the repo or a real vault.
import fs from "fs";
import os from "os";
import path from "path";

const repo = path.resolve(__dirname, "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "marquee-test-"));
const vault = path.join(scratch, "vault");
fs.cpSync(path.join(repo, "vault-template"), vault, { recursive: true });
process.env.VAULT_PATH = vault;
process.env.ANTHROPIC_API_KEY ??= "test-key";
delete process.env.MARQUEE_ENGINE;
process.chdir(scratch);
