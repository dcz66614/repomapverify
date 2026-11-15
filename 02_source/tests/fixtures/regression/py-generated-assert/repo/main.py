import billing.api
from billing.auth import login


def run():
    billing.api.serve()
    login()
