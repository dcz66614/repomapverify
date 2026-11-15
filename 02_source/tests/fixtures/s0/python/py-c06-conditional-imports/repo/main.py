from typing import TYPE_CHECKING

try:
    import fastapi
except ImportError:
    fastapi = None

if TYPE_CHECKING:
    from billing.types import Invoice

from billing.api import serve
