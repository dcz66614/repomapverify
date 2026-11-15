"""Demo shop: API layer. Real imports: auth, cart."""
import auth
import cart


def serve():
    auth.login()
    cart.checkout()
