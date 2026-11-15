from billing import api
from billing.api import get_invoice
from billing.reports import monthly


def main():
    api.get_invoice()
    get_invoice()
    monthly.build()
