# Navigation Policy Report

## Implemented Policies
1. **same-origin**: Restricts visits exclusively to initial start_url origin.
2. **same-site**: Permits same registrable domain and subdomains (e.g., `python.org` -> `docs.python.org`).
3. **public-http**: Allows visiting any public HTTP/HTTPS destination while strictly enforcing SSRF and private network blocking.
4. **explicit-allowlist**: Permits origins matching `allowedDomains` list.

## Precedence Rules
- If `navigationPolicy` is explicitly provided, it takes precedence.
- If `allowedDomains` is provided without `navigationPolicy`, default is `explicit-allowlist`.
- If neither is provided, default fallback is `same-origin`.
