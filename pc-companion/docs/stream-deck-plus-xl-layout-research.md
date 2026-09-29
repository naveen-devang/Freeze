# Stream Deck XL keys and Stream Deck + XL touch strip

Research date: 2026-09-28. Sources are official Elgato product, support, and SDK documentation.

## Finding

Elgato presents standard Stream Deck keys as discrete LCD keys: its software assigns an action to a key, and the XL is specified as 32 configurable keys. Stream Deck + XL is a separate product with 36 keys, six dials, and a touch strip. Its documentation describes placing actions on keys or dials; I found no official user-facing feature for dragging key edges to span multiple key cells. Freeze can offer resizable buttons as its own layout capability, but should not describe that behavior as matching an Elgato key-layout feature. [Stream Deck XL quick start](https://help.elgato.com/hc/en-us/articles/18176013425165-Elgato-Stream-Deck-XL-Quick-Start-Guide) · [Device comparison](https://www.elgato.com/ww/en/explorer/products/stream-deck/stream-deck-device-comparison/) · [Actions SDK guide](https://docs.elgato.com/streamdeck/sdk/guides/actions/)

The + XL touch strip is a distinct surface associated with its dials, rather than an oversized key. Elgato's SDK gives each dial action a 200 × 100 px canvas; plugins cannot render across the whole strip through the documented per-dial layout API. The SDK supports text, images, bars, and other layout elements, with runtime feedback updates. The Stream Deck + support guide also documents tap, tap-and-hold, and swipe interactions, including swipe navigation between pages. [Touch Strip Layout reference](https://docs.elgato.com/streamdeck/sdk/v1/references/touch-strip-layout/) · [Dials & Touch Strip guide](https://docs.elgato.com/streamdeck/sdk/guides/dials/) · [Touch Strip support guide](https://help.elgato.com/hc/en-us/articles/10567698991629-Elgato-Stream-Deck-Touch-Strip)

## Freeze direction

- Keep the existing button grid and make a button occupy a rectangular span of grid cells, such as 1×2, 2×1, or 2×2. Let users drag a resize handle, snap to whole cells, show an occupancy preview, and reject overlaps or spans outside the grid.
- Treat the requested bottom-wide area as a separate **Widget strip** across the full deck width, visually distinct from button cells. Initially it can be empty; later widgets/plugins can contribute independent content and interactions.
- Persist a button's grid position and row/column span in the profile page data. Keep old decks equivalent to 1×1 buttons when span fields are absent.
- Define the Widget strip as a sequence of bounded slots with explicit size and supported interaction regions. This supports text, meters, images, and touch targets without making every plugin draw into one shared unrestricted canvas.
- Keep touch input optional in Freeze's phone UI: taps remain button actions, while strip widgets can expose only the gestures they need. If Freeze later targets hardware with dials, associate strip regions with dials as a separate controller model rather than stretching ordinary keys.

## Sources

- [Elgato Stream Deck XL Quick Start Guide](https://help.elgato.com/hc/en-us/articles/18176013425165-Elgato-Stream-Deck-XL-Quick-Start-Guide)
- [Elgato Stream Deck device comparison](https://www.elgato.com/ww/en/explorer/products/stream-deck/stream-deck-device-comparison/)
- [Stream Deck SDK: Actions](https://docs.elgato.com/streamdeck/sdk/guides/actions/)
- [Stream Deck SDK: Dials & Touch Strip](https://docs.elgato.com/streamdeck/sdk/guides/dials/)
- [Stream Deck SDK: Touch Strip Layout](https://docs.elgato.com/streamdeck/sdk/v1/references/touch-strip-layout/)
- [Elgato: Stream Deck + Touch Strip](https://help.elgato.com/hc/en-us/articles/10567698991629-Elgato-Stream-Deck-Touch-Strip)
- [Elgato Stream Deck + XL product page](https://www.elgato.com/ww/en/p/stream-deck-plus-xl)
