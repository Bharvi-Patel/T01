"""Minimal SMTP mailer used for account email verification.

Reads its config from the environment (see .env):
    SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL, SMTP_USE_TLS

If SMTP_HOST isn't set, send_email() prints the message to stdout instead of
sending it - so signup/verification flows are still testable in local dev
without a real mail server configured.
"""
import logging
import os
import smtplib
from email.mime.text import MIMEText

from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger("emailer")

SMTP_HOST = os.environ.get("SMTP_HOST")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD")
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", "no-reply@starttrack.app")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() != "false"


def send_email(to_email: str, subject: str, body: str) -> None:
    """Send a plaintext email, or print it to the console if SMTP isn't configured."""
    if not SMTP_HOST:
        logger.warning("SMTP_HOST not set - printing email instead of sending it.")
        print(
            f"\n--- DEV EMAIL (SMTP not configured) ---\n"
            f"To: {to_email}\nSubject: {subject}\n\n{body}\n"
            f"----------------------------------------\n"
        )
        return

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM_EMAIL
    msg["To"] = to_email

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        if SMTP_USE_TLS:
            server.starttls()
        if SMTP_USERNAME and SMTP_PASSWORD:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(msg)


def send_verification_email(to_email: str, token: str, frontend_base_url: str) -> None:
    verify_url = f"{frontend_base_url.rstrip('/')}/?verify_token={token}"
    subject = "Verify your startTrack email"
    body = (
        "Welcome to startTrack!\n\n"
        "Confirm your email address by opening the link below:\n\n"
        f"{verify_url}\n\n"
        "This link expires in 24 hours. If you didn't create this account, "
        "you can safely ignore this email."
    )
    send_email(to_email, subject, body)