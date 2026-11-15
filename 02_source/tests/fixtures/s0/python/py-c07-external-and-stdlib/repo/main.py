import json
import os.path
import numpy as np
from billing.api import serve


def run():
    serve()
    return json.dumps({})
