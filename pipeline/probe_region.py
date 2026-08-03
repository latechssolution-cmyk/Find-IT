"""Find the project's pooler region (IPv4 path) and write the working DSN
back into .env.supabase. The direct db.<ref> host is IPv6-only, which this
network can't reach — the session pooler is region-scoped, so we probe.

A wrong-region pooler answers "Tenant or user not found"; the right one
either connects or fails on password alone. Passwords never hit argv/stdout.
"""

from pathlib import Path
import sys

import psycopg

ENV = Path(__file__).parent / ".env.supabase"

REGIONS = [
    "ap-south-1", "ap-southeast-1", "us-east-1", "eu-central-1",
    "ap-northeast-1", "us-west-1", "eu-west-1", "eu-west-2", "us-east-2",
    "ap-southeast-2", "sa-east-1", "ca-central-1",
]


def env() -> dict:
    out = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def main() -> None:
    e = env()
    ref, pw = e["SUPABASE_PROJECT_REF"], e["SUPABASE_DB_PASSWORD_ENC"]
    # "(ENOTFOUND) tenant not found" = wrong region; DNS failures = ISP flake,
    # retry. 6543 (transaction pooler) — schema DDL works there too.
    for aws in ("aws-0", "aws-1"):
        for reg in REGIONS:
            host = f"{aws}-{reg}.pooler.supabase.com"
            port = 6543
            dsn = f"postgresql://postgres.{ref}:{pw}@{host}:{port}/postgres"
            try:
                with psycopg.connect(dsn, connect_timeout=8) as c:
                    ver = c.execute("select version()").fetchone()[0][:60]
                    print(f"CONNECTED via {host}:{port}")
                    print(f"  {ver}")
                    txt = ENV.read_text(encoding="utf-8")
                    txt = txt.replace("SUPABASE_DB_URL=", f"SUPABASE_DB_URL={dsn}")
                    ENV.write_text(txt, encoding="utf-8")
                    print("  DSN written to .env.supabase")
                    return
            except Exception as ex:  # noqa: BLE001
                print(f"{host}:{port}: {str(ex)[:400]}")
    sys.exit("no pooler region matched — check password or network")


if __name__ == "__main__":
    main()
