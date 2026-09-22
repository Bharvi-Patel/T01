from py_vapid import Vapid
from py_vapid.utils import b64urlencode
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

v = Vapid()
v.generate_keys()

priv_raw = v.private_key.private_numbers().private_value.to_bytes(32, "big")
pub_raw = v.public_key.public_bytes(
    encoding=Encoding.X962,
    format=PublicFormat.UncompressedPoint,
)

print("Add these to your .env (and your server's real env config):\n")
print(f"VAPID_PRIVATE_KEY={b64urlencode(priv_raw)}")
print(f"VAPID_PUBLIC_KEY={b64urlencode(pub_raw)}")