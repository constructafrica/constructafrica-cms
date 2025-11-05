export default ({ filter, action }) => {
    action('favorites.items.create', async ({ payload }, { database }) => {
        const { collection, item_id } = payload;
        await database(collection)
            .where('id', item_id)
            .increment('favorites_count', 1);
    });

    action('favorites.items.delete', async ({ keys }, { database }) => {
        const favorites = await database('favorites')
            .whereIn('id', keys)
            .select('collection', 'item_id');

        for (const fav of favorites) {
            await database(fav.collection)
                .where('id', fav.item_id)
                .decrement('favorites_count', 1);
        }
    });
};