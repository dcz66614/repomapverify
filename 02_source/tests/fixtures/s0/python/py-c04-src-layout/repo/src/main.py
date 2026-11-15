import app.api
from app.db import connect


def main():
    app.api.serve()
    connect()
