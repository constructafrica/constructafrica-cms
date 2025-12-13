export async function addFavoritesStatus({
                                             items,
                                             collection,
                                             userId,
                                             schema,
                                             accountability,
                                             ItemsService,
                                             idKey = 'id',
                                         }) {
    if (!items || items.length === 0 || !userId) {
        return items.map(item => ({
            ...item,
            is_favorited: false,
            favorite_id: null,
        }));
    }

    const favoritesService = new ItemsService('favourites', {
        schema,
        accountability,
    });

    const itemIds = items
        .map(item => item[idKey])
        .filter(Boolean);

    if (itemIds.length === 0) return items;

    const favorites = await favoritesService.readByQuery({
        filter: {
            _and: [
                { user_created: { _eq: userId } },
                { collection: { _eq: collection } },
                { item_id: { _in: itemIds } },
            ],
        },
        fields: ['id', 'item_id'],
        limit: -1,
    });

    const favoritesMap = new Map(
        favorites.map(fav => [fav.item_id, fav.id])
    );

    return items.map(item => ({
        ...item,
        is_favorited: favoritesMap.has(item[idKey]),
        favorite_id: favoritesMap.get(item[idKey]) ?? null,
    }));
}

export async function getFavoriteStatus({
                                            itemId,
                                            collection,
                                            userId,
                                            schema,
                                            accountability,
                                            ItemsService
                                        }) {
    if (!itemId || !userId) {
        return {
            is_favorited: false,
            favorite_id: null,
        };
    }

    try {
        const favoritesService = new ItemsService('favourites', {
            schema,
            accountability,
        });

        const favorites = await favoritesService.readByQuery({
            filter: {
                _and: [
                    { user_created: { _eq: userId } },
                    { collection: { _eq: collection } },
                    { item_id: { _eq: itemId } },
                ],
            },
            fields: ['id'],
            limit: 1,
        });

        if (favorites.length > 0) {
            return {
                is_favorited: true,
                favorite_id: favorites[0].id,
            };
        }

        return {
            is_favorited: false,
            favorite_id: null,
        };
    } catch (error) {
        console.warn('Failed to fetch favorite status:', error.message);
        return {
            is_favorited: false,
            favorite_id: null,
        };
    }
}