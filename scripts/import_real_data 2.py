#!/usr/bin/env python3
import argparse
import hashlib
import json
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


def clean(value):
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    if text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def lower_or_none(value):
    value = clean(value)
    return value.lower() if value else None


def random_id(prefix):
    return f"{prefix}_{secrets.token_hex(9)}"


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(str(password).encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1, dklen=64)
    return salt, digest.hex()


def ensure_column(conn, table, column, definition):
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def ensure_schema(conn):
    for column, definition in {
        "legal_name": "TEXT",
        "province": "TEXT",
        "source_ref": "TEXT",
    }.items():
        ensure_column(conn, "clients", column, definition)

    for column, definition in {
        "dni": "TEXT",
        "social_security_number": "TEXT",
        "bank_account": "TEXT",
        "address": "TEXT",
        "province": "TEXT",
        "postal_code": "TEXT",
        "birth_date": "TEXT",
        "shirt_size": "TEXT",
        "pants_size": "TEXT",
        "shoe_size": "TEXT",
        "jacket_size": "TEXT",
        "epi_size": "TEXT",
        "emergency_contact": "TEXT",
        "source_ref": "TEXT",
        "imported_at": "TEXT",
    }.items():
        ensure_column(conn, "employees", column, definition)

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS data_imports (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          rows_read INTEGER NOT NULL DEFAULT 0,
          inserted INTEGER NOT NULL DEFAULT 0,
          updated INTEGER NOT NULL DEFAULT 0,
          skipped INTEGER NOT NULL DEFAULT 0,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def find_user(conn, email, phone):
    return conn.execute(
        """
        SELECT * FROM users
        WHERE (? IS NOT NULL AND lower(email) = ?)
           OR (? IS NOT NULL AND phone = ?)
        LIMIT 1
        """,
        (email, email, phone, phone),
    ).fetchone()


def upsert_employee_user(conn, name, email, phone, default_password):
    user = find_user(conn, email, phone)
    if user:
        conn.execute(
            """
            UPDATE users
            SET role = 'employee', name = ?, email = COALESCE(?, email), phone = COALESCE(?, phone), active = 1
            WHERE id = ?
            """,
            (name, email, phone, user["id"]),
        )
        return user["id"], False

    salt, password_hash = hash_password(default_password)
    user_id = random_id("usr")
    conn.execute(
        """
        INSERT INTO users (id, role, name, email, phone, password_hash, salt, active)
        VALUES (?, 'employee', ?, ?, ?, ?, ?, 1)
        """,
        (user_id, name, email, phone, password_hash, salt),
    )
    return user_id, True


def find_employee(conn, dni, email, phone):
    if dni:
        row = conn.execute("SELECT * FROM employees WHERE dni = ? LIMIT 1", (dni,)).fetchone()
        if row:
            return row
    if email:
        row = conn.execute("SELECT * FROM employees WHERE lower(email) = ? LIMIT 1", (email,)).fetchone()
        if row:
            return row
    if phone:
        row = conn.execute("SELECT * FROM employees WHERE phone = ? LIMIT 1", (phone,)).fetchone()
        if row:
            return row
    return None


def import_employees(conn, path, default_password):
    source = Path(path).name
    df = pd.read_excel(path, dtype=str).dropna(how="all")
    inserted = updated = skipped = 0
    now = datetime.now(timezone.utc).isoformat()

    for _, row in df.iterrows():
        first_name = clean(row.get("NOMBRE"))
        last_name = clean(row.get("APELLIDOS"))
        name = " ".join(part for part in [first_name, last_name] if part)
        phone = clean(row.get("TELEFONO"))
        email = lower_or_none(row.get("CORREO ELECTRONICO"))
        dni = clean(row.get("D.N.I."))
        social_security = clean(row.get("NºSEG.SOCIAL"))
        bank_account = clean(row.get("Nº DE CUENTA BANCARIA"))
        if not name:
            skipped += 1
            continue

        user_id, _ = upsert_employee_user(conn, name, email, phone, default_password)
        existing = find_employee(conn, dni, email, phone)
        if existing:
            conn.execute(
                """
                UPDATE employees
                SET user_id = COALESCE(user_id, ?), name = ?, phone = COALESCE(?, phone), email = COALESCE(?, email),
                    dni = COALESCE(?, dni), social_security_number = COALESCE(?, social_security_number),
                    bank_account = COALESCE(?, bank_account), status = 'activo',
                    role = CASE WHEN role IS NULL OR role = '' THEN 'Operario' ELSE role END,
                    source_ref = ?, imported_at = ?
                WHERE id = ?
                """,
                (user_id, name, phone, email, dni, social_security, bank_account, source, now, existing["id"]),
            )
            updated += 1
        else:
            conn.execute(
                """
                INSERT INTO employees
                  (id, user_id, name, role, phone, email, status, city, hourly_rate, diet_rate, skills,
                   dni, social_security_number, bank_account, source_ref, imported_at)
                VALUES (?, ?, ?, 'Operario', ?, ?, 'activo', '', 0, 0, '["operario"]', ?, ?, ?, ?, ?)
                """,
                (random_id("emp"), user_id, name, phone, email, dni, social_security, bank_account, source, now),
            )
            inserted += 1

    record_import(conn, source, len(df), inserted, updated, skipped, {"kind": "employees"})
    return {"source": source, "rows_read": int(len(df)), "inserted": inserted, "updated": updated, "skipped": skipped}


def find_client(conn, tax_id, name):
    if tax_id:
        row = conn.execute("SELECT * FROM clients WHERE tax_id = ? LIMIT 1", (tax_id,)).fetchone()
        if row:
            return row
    if name:
        row = conn.execute("SELECT * FROM clients WHERE lower(name) = ? LIMIT 1", (name.lower(),)).fetchone()
        if row:
            return row
    return None


def import_clients(conn, path):
    source = Path(path).name
    df = pd.read_excel(path, dtype=str).dropna(how="all")
    inserted = updated = skipped = 0

    for _, row in df.iterrows():
        name = clean(row.get("CLIENTE")) or clean(row.get("RAZON SOCIAL"))
        legal_name = clean(row.get("RAZON SOCIAL")) or name
        if not name:
            skipped += 1
            continue
        tax_id = clean(row.get("CIF"))
        contact_name = clean(row.get("PERSONA CONTACTO"))
        address = clean(row.get("DIRECCIÓN ")) or ""
        province = clean(row.get("PROVINCIA")) or ""
        email = lower_or_none(row.get("MAIL"))
        phone = clean(row.get("TELEFONO"))
        notes = clean(row.get("OBSERVACIONES")) or ""

        existing = find_client(conn, tax_id, name)
        if existing:
            conn.execute(
                """
                UPDATE clients
                SET name = ?, legal_name = ?, tax_id = COALESCE(?, tax_id), contact_name = COALESCE(?, contact_name),
                    email = COALESCE(?, email), phone = COALESCE(?, phone), address = COALESCE(?, address),
                    province = COALESCE(?, province), notes = COALESCE(?, notes), source_ref = ?
                WHERE id = ?
                """,
                (name, legal_name, tax_id, contact_name, email, phone, address, province, notes, source, existing["id"]),
            )
            updated += 1
        else:
            conn.execute(
                """
                INSERT INTO clients (id, name, legal_name, tax_id, contact_name, email, phone, address, province, notes, source_ref)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (random_id("cli"), name, legal_name, tax_id, contact_name, email, phone, address, province, notes, source),
            )
            inserted += 1

    record_import(conn, source, len(df), inserted, updated, skipped, {"kind": "clients"})
    return {"source": source, "rows_read": int(len(df)), "inserted": inserted, "updated": updated, "skipped": skipped}


def record_import(conn, source, rows_read, inserted, updated, skipped, metadata):
    conn.execute(
        """
        INSERT INTO data_imports (id, source, rows_read, inserted, updated, skipped, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (random_id("imp"), source, rows_read, inserted, updated, skipped, json.dumps(metadata, ensure_ascii=False)),
    )


def main():
    parser = argparse.ArgumentParser(description="Importa trabajadores y clientes reales en MARFAN CREW ERP.")
    parser.add_argument("--db", default="data/marfan.sqlite")
    parser.add_argument("--employees")
    parser.add_argument("--clients")
    parser.add_argument("--default-password", default="Marfan2026!")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema(conn)
    results = {}
    with conn:
        if args.employees:
            results["employees"] = import_employees(conn, args.employees, args.default_password)
        if args.clients:
            results["clients"] = import_clients(conn, args.clients)
    conn.close()
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
