from .items import Item
from ..shared import fmt


class Cart:
    def __init__(self):
        self.item = Item()
        fmt("cart")
