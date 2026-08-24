from py_vapid import Vapid02
from cryptography.hazmat.primitives import serialization
import base64

v = Vapid02.from_file('private_key.pem')
pub_raw = v.public_key.public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)
print(base64.urlsafe_b64encode(pub_raw).rstrip(b'=').decode())