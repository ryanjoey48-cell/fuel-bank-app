# EES V20.3 — production encrypted logical backup execution

**Status:** SUCCESS (partial logical backup)  
**Production:** `hafoaurzfgkkwpvzedvd` (Fuel Tracker App)  
**Development (untouched):** `wpmnjfncaoogssgpqxek`  
**SQL gate:** remains **NO-GO** until isolated restore drill PASSes.

## Result

Encrypted logical backup completed. No production SQL migration, no writes beyond dump reads, no deploy, no commit/push, Development not touched.

### Protected locations (outside Git)

| Kind | Path |
| --- | --- |
| Ciphertext | `C:\Users\joery\AppData\Local\EES\production-backups\20261101-194605` |
| Key material | `C:\Users\joery\AppData\Local\EES\production-backup-keys\20261101-194605` |

ACLs: current Windows user only (`icacls` inheritance removed).

### Artifacts

| File | Bytes | SHA256 |
| --- | --- | --- |
| `roles.sql.aes` | 6,688 | `0A3F6795300BEF120FB186454FD91441A5CE17884EA313A3A558B65F5015DC05` |
| `schema.sql.aes` | 495,792 | `87CA84A757FA8556964F53DE6A5F982DC0CF894AE7A28861223B8407D36FF2AB` |
| `data.sql.aes` | 7,599,792 | `039BCA4F570C90BDC762C2629466F331AE8113AC87583F8E4EEA7255DE981532` |
| `SHA256SUMS.txt` | checksum list | verified PASS |
| `KEY_LOCATION.txt` | pointer only | no key bytes |

Key folder: `backup.key` (32 bytes), `backup.iv` (16 bytes), `backup-meta.txt`.

Plaintext `.sql` overwritten and deleted after encrypt (**0** plaintext SQL remaining).

## Method note

`npx supabase db dump` could not run: Docker/Podman are not installed on this workstation.  

Fallback used (same security controls): local PostgreSQL 17 `pg_dump` / `pg_dumpall`, fresh Management API `cli/login-role` password (not the previously exposed dry-run secret), `PGOPTIONS=-c role=postgres`, password only via env (not printed), AES-256-CBC encrypt, separate key directory, checksum + decrypt validation.

## Coverage (no customer data shown)

- **Included:** `public` schema DDL + data; roles without role passwords  
- **Inventory:** 96 tables, 1 view, 100 functions, 96 COPY targets  
- **Gaps:** Auth, Storage, Realtime, Vault, Edge Functions, Dashboard settings, role passwords, extensions re-check on restore  
- **Restore warning:** circular FK on `ees_employee_documents` (use `--disable-triggers` or careful restore order)

## Decrypt validation

`schema.sql.aes` decrypted off-repo to a temp file: byte size matched pre-encrypt plaintext; PostgreSQL dump header confirmed; temp plaintext wiped. No plaintext stored in the repository.

## Next step — isolated restore drill (separate approval)

1. Create a **new temporary** Supabase project (not Development, not production).  
2. Decrypt using the separated key directory.  
3. Restore and validate counts/structure.  
4. Only after PASS: re-open production Fleet Operations SQL gate.
