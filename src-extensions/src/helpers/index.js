import { createHash, randomBytes } from "crypto";

export async function addFavoritesStatus({
  items,
  collection,
  userId,
  schema,
  accountability,
  ItemsService,
  idKey = "id",
}) {
  if (!items || items.length === 0 || !userId) {
    return items.map((item) => ({
      ...item,
      is_favorited: false,
      favorite_id: null,
    }));
  }

  const favoritesService = new ItemsService("favourites", {
    schema,
    accountability,
  });

  const itemIds = items.map((item) => item[idKey]).filter(Boolean);

  if (itemIds.length === 0) return items;

  const favorites = await favoritesService.readByQuery({
    filter: {
      _and: [
        { user_created: { _eq: userId } },
        { collection: { _eq: collection } },
        { item_id: { _in: itemIds } },
      ],
    },
    fields: ["id", "item_id"],
    limit: -1,
  });

  const favoritesMap = new Map(favorites.map((fav) => [fav.item_id, fav.id]));

  return items.map((item) => ({
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
  ItemsService,
}) {
  if (!itemId || !userId) {
    return {
      is_favorited: false,
      favorite_id: null,
    };
  }

  try {
    const favoritesService = new ItemsService("favourites", {
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
      fields: ["id"],
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
    console.warn("Failed to fetch favorite status:", error.message);
    return {
      is_favorited: false,
      favorite_id: null,
    };
  }
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateVerificationToken() {
  return randomBytes(32).toString("hex");
}

/**
 * Get total and filtered counts for a Directus collection
 */
export async function getCollectionCounts({ service, filter = {} }) {
  // Total count (no filters)
  const totalResult = await service.readByQuery({
    aggregate: { count: ["*"] },
  });

  const totalCount = Number(totalResult?.[0]?.count || 0);

  // Filtered count
  let filterCount = totalCount;

  if (filter && Object.keys(filter).length > 0) {
    const filteredResult = await service.readByQuery({
      filter,
      aggregate: { count: ["*"] },
    });

    filterCount = Number(filteredResult?.[0]?.count || 0);
  }

  return {
    totalCount,
    filterCount,
  };
}

export async function addRelationStatus({
  items,
  userId,
  schema,
  accountability,
  collection,
  itemField,
  userField = "user_created",
  extraFilter = {},
  flagName,
  idName = null,
}) {
  if (!items || items.length === 0) return items;

  const service = new ItemsService(collection, {
    schema,
    accountability,
  });

  const itemIds = items.map((item) => item.id);

  const records = await service.readByQuery({
    filter: {
      _and: [
        { [userField]: { _eq: userId } },
        { [itemField]: { _in: itemIds } },
        ...Object.entries(extraFilter).map(([key, value]) => ({
          [key]: { _eq: value },
        })),
      ],
    },
    fields: ["id", itemField],
    limit: -1,
  });

  const map = new Map();
  records.forEach((r) => {
    map.set(r[itemField], r.id);
  });

  return items.map((item) => ({
    ...item,
    [flagName]: map.has(item.id),
    ...(idName ? { [idName]: map.get(item.id) || null } : {}),
  }));
}
