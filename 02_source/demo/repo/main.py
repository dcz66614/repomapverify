"""Demo shop: entrypoint. Real imports: api, cart."""
import api
import cart


def main():
    api.serve()
    cart.checkout()


if __name__ == "__main__":
    main()
