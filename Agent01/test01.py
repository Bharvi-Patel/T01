import os, re
from dotenv import load_dotenv, find_dotenv

print("dotenv file found at:", find_dotenv())
load_dotenv(override=True)

val = os.environ.get("VAPID_CLAIMS_EMAIL", "mailto:no-reply@starttrack.app")
print("repr(value):", repr(val))

pattern = r"^(mailto:.+@((localhost|[%\w-]+(\.[%\w-]+)+|([0-9a-f]{1,4}):+([0-9a-f]{1,4})?)))|https:\/\/(localhost|[\w-]+\.[\w\.-]+|([0-9a-f]{1,4}:+)+([0-9a-f]{1,4})?)$"
print("passes _check_sub regex:", re.match(pattern, val, re.IGNORECASE) is not None)