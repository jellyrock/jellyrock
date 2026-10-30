---
pitch: Delete a movie, an episode or any other item from your server, from its details page, when your account may.
since: 1.13.0
server: 10.7.0
highlight: 3
---

# Delete media

The **Delete** button on an item's details page deletes that item from your Jellyfin server. It takes the item out of your library and deletes its files from the server's disk.

> [!CAUTION]
> Deleting can't be undone. The files are gone from your server, not only hidden from the library.

## What you need

Permission to delete media on your Jellyfin account. An admin sets it for each user in the Jellyfin dashboard, for every library or only some of them.

JellyRock shows **Delete** only on items your server says your account may delete, so you never see a button that can't work.

## Delete an item

1. Open the item's details page.
2. Select **Delete**.
3. JellyRock asks "Are you sure you want to delete this item? This action cannot be undone." Select **Delete** to delete it, or **Cancel** to keep it.

Once it's deleted, JellyRock goes back to the screen you came from, and that library loads again without the item.

## Troubleshooting

- **There is no Delete button.** Your account may not delete this item. Ask your server's admin to let your account delete media, for every library or for this item's library, then open the item again.
