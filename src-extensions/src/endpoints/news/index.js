import {addFavoritesStatus, getFavoriteStatus} from "../../helpers/index.js";

export default (router, { services, database, getSchema}) => {
    const {ItemsService} = services;

    async function addNewsFavoritesStatus(
        companies,
        userId,
        schema,
        accountability
    ) {
        return await addFavoritesStatus({
            items: companies,
            collection: 'main_news',
            userId,
            schema,
            accountability,
            ItemsService,
        });
    }

    function groupNews(data, groupBy) {
        const groups = new Map();

        data.forEach(item => {
            let groupKeys = [];

            switch (groupBy) {
                case 'country':
                    groupKeys = item._originals.countries.map(c => ({
                        id: c.countries_id?.id,
                        name: c.countries_id?.name || 'Unknown Country',
                        data: c.countries_id
                    }));
                    break;
                case 'region':
                    groupKeys = item._originals.regions.map(r => ({
                        id: r.regions_id?.id,
                        name: r.regions_id?.name || 'Unknown Region',
                        data: r.regions_id
                    }));
                    break;
                case 'sector':
                    groupKeys = item._originals.sectors.map(c => ({
                        id: c.sectors_id?.id,
                        name: c.sectors_id?.name || 'Unknown Sector',
                        data: c.sectors_id
                    }));
                    break;
                default:
                    groupKeys = [{ id: 'all', name: 'All News', data: null }];
            }

            // If no group keys found, add to "Unknown" group
            if (groupKeys.length === 0) {
                groupKeys = [{ id: 'unknown', name: `Unknown ${groupBy}`, data: null }];
            }

            // Add item to each group it belongs to
            groupKeys.forEach(groupKey => {
                if (!groups.has(groupKey.id)) {
                    groups.set(groupKey.id, {
                        id: groupKey.id,
                        name: groupKey.name,
                        data: groupKey.data,
                        news: [],
                        count: 0,
                        totalValue: 0
                    });
                }

                const group = groups.get(groupKey.id);

                // Remove _originals before adding to group
                const cleanItem = { ...item };
                delete cleanItem._originals;

                group.news.push(cleanItem);
                group.count++;
            });
        });

        // Convert Map to Array and sort by name
        return Array.from(groups.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    }


    router.get('/', async (req, res, next) => {
        try {
            const { accountability } = req;
            const schema = await getSchema();
            const newsService = new ItemsService('main_news', {
                schema: schema,
                accountability: req.accountability
            });

            const groupBy = req.query.groupBy;
            const limit = parseInt(req.query.limit) || 25;
            const page = parseInt(req.query.page) || 1;
            const offset = (page - 1) * limit;

            // Get total count using database connection directly
            let totalCount = 0;
            let filterCount = 0;

            try {
                const filterObj = req.query.filter || {};

                // Access the database connection through the service
                const knex = database;

                // Build count query
                // For now, this gets the total count without filters
                const totalResult = await knex('main_news').count('* as count');
                totalCount = parseInt(totalResult[0]?.count) || 0;

                // For filtered count, if you have filters, you'd need to apply them
                // This is a simplified version - expand based on your filter needs
                if (Object.keys(filterObj).length > 0) {
                    // You can implement filter logic here or use the service
                    filterCount = totalCount; // Simplified - same as total for now
                } else {
                    filterCount = totalCount;
                }

                console.log('Total count from DB:', totalCount);
            } catch (countError) {
                console.error('Error getting count:', countError);
                // Fallback to news length
                totalCount = news?.length || 0;
                filterCount = totalCount;
            }

            // Fetch news
            const news = await newsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'summary',
                    'is_free_news',
                    'content',
                    'date_created',

                    'countries',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',

                    'regions.regions_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',

                    'sectors.sectors_id.slug',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.id',

                    'created_by.first_name',
                    'created_by.last_name',
                    'created_by.email',
                    'created_by.avatar',
                    'created_by.avatar.id',
                    'created_by.avatar.filename_disk',
                    'created_by.avatar.title',
                    'created_by.avatar.filesize',

                    'featured_image',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                    'featured_image.filesize',
                ],
                limit: groupBy ? -1 : limit,
                sort: ['-date_created'],
                offset: groupBy ? 0 : offset,
                filter: req.query.filter || {},
            });

            // Build proper meta object
            const meta = {
                total_count: totalCount,
                filter_count: filterCount,
                limit: limit,
                page: page,
                page_count: Math.ceil(totalCount / limit)
            };

            console.log('Final meta:', meta);

            // Transform news
            const transformedNews = news.map(item => {

                // Transform featured_image
                if (item.featured_image) {
                    if (typeof item.featured_image === 'object' && item.featured_image.id) {
                        item.featured_image.url = `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}`;
                        item.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}?width=400&height=300&fit=cover`;
                    }
                }

                // Store original M2M data before flattening
                const originalCountries = item.countries ? [...item.countries] : [];
                const originalRegions = item.regions ? [...item.regions] : [];
                const originalSectors = item.sectors ? [...item.sectors] : [];

                // Flatten M2M relations
                if (item.countries && Array.isArray(item.countries)) {
                    item.countries = item.countries.map(c => c.countries_id).filter(Boolean);
                }
                if (item.regions && Array.isArray(item.regions)) {
                    item.regions = item.regions.map(r => r.regions_id).filter(Boolean);
                }
                if (item.sectors && Array.isArray(item.sectors)) {
                    item.sectors = item.sectors.map(t => t.sectors_id).filter(Boolean);
                }

                // Store originals for grouping
                if (groupBy) {
                    item._originals = {
                        countries: originalCountries,
                        regions: originalRegions,
                        sectors: originalSectors,
                    };
                }

                return item;
            });

            // Handle grouping
            if (groupBy) {
                const grouped = groupNews(transformedNews, groupBy);
                const groupLimit = parseInt(req.query.limit) || 5;
                const groupPage = parseInt(req.query.page) || 1;
                const totalGroups = grouped.length;
                const start = (groupPage - 1) * groupLimit;
                const end = start + groupLimit;
                const paginatedGroups = grouped.slice(start, end);

                return res.json({
                    data: paginatedGroups,
                    meta: {
                        total_groups: totalGroups,
                        groupBy: groupBy,
                        page: groupPage,
                        limit: groupLimit,
                        page_count: Math.ceil(totalGroups / groupLimit)
                    }
                });
            }

            // Add favorites status
            let finalNews;
            if (accountability?.user) {
                finalNews = await addNewsFavoritesStatus(
                    transformedNews,
                    accountability.user,
                    schema,
                    req.accountability
                );
            } else {
                finalNews = transformedNews.map(item => ({
                    ...item,
                    is_favorited: false,
                    favorite_id: null
                }));
            }

            return res.json({
                data: finalNews,
                meta: meta
            });

        } catch (error) {
            console.error("News error:", error);
            next(error);
        }
    });

    router.get('/stats/filters', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { q } = req.query;

            // Validate filter parameter
            const validFilters = ['sector', 'region'];
            if (!q || !validFilters.includes(q)) {
                return res.status(400).json({
                    error: 'Invalid filter parameter. Must be one of: sector, region'
                });
            }

            const itemService = new ItemsService('main_news', {
                schema: schema,
                accountability: req.accountability
            });

            // Get all projects with the relevant relations
            const fieldMap = {
                sector: 'sectors.sectors_id.*',
                region: 'regions.regions_id.*'
            };

            const items = await itemService.readByQuery({
                fields: ['id', fieldMap[q]],
                limit: -1 // Get all items
            });

            // Get the relation key
            const relationKey = q === 'sector' ? 'sectors' : 'regions';
            const idKey = `${q === 'type' ? 'types' :
                q === 'sector' ? 'sectors' : 'regions'}_id`;

            // Count occurrences
            const statsMap = new Map();
            let totalItems = 0;

            items.forEach(data => {
                if (data[relationKey] && Array.isArray(data[relationKey])) {
                    data[relationKey].forEach(rel => {
                        if (rel[idKey]) {
                            const item = rel[idKey];
                            const key = item.id;

                            if (!statsMap.has(key)) {
                                statsMap.set(key, {
                                    id: item.id,
                                    name: item.name,
                                    slug: item.slug || null,
                                    count: 0
                                });
                            }

                            statsMap.get(key).count++;
                            totalItems++;
                        }
                    });
                }
            });

            // Convert to array and calculate percentages
            const stats = Array.from(statsMap.values())
                .map(stat => ({
                    ...stat,
                    percentage: totalItems > 0
                        ? Math.round((stat.count / totalItems) * 100 * 10) / 10
                        : 0
                }))
                .sort((a, b) => b.count - a.count); // Sort by count descending

            return res.json({
                data: {
                    filter: q,
                    total: items.length,
                    stats: stats
                }
            });

        } catch (error) {
            console.error('item stats error:', error);
            next(error);
        }
    });


    router.get('/:id', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { accountability } = req;
            const itemId = req.params.id;

            const newsService = new ItemsService('main_news', {
                schema: schema,
                accountability: req.accountability
            });

            const item = await newsService.readOne(itemId, {
                fields: [
                    '*',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',

                    'regions.regions_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',

                    'sectors.sectors_id.slug',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.id',

                    'related_projects.projects_id.id',
                    'related_projects.projects_id.title',
                    'related_projects.projects_id.summary',
                    'related_projects.projects_id.current_status.name',
                    'related_projects.projects_id.contract_value_usd',
                    'related_projects.projects_id.value_range',
                    'related_projects.projects_id.countries.countries_id.id',
                    'related_projects.projects_id.countries.countries_id.name',
                    'related_projects.projects_id.countries.countries_id.slug',

                    'related_companies.companies_id.id',
                    'related_companies.companies_id.name',
                    'related_companies.companies_id.email',
                    'related_companies.companies_id.countries.countries_id.id',
                    'related_companies.companies_id.countries.countries_id.name',
                    'related_companies.companies_id.countries.countries_id.slug',

                    'related_news.news_id.id',
                    'related_news.news_id.title',
                    'related_news.news_id.slug',
                    'related_news.news_id.summary',
                    'related_news.news_id.is_trending',
                    'related_news.news_id.countries.countries_id.id',
                    'related_news.news_id.countries.countries_id.name',
                    'related_news.news_id.countries.countries_id.slug',

                    'created_by.id',
                    'created_by.first_name',
                    'created_by.last_name',
                    'created_by.email',
                    'created_by.facebook_url',
                    'created_by.linkedin_url',
                    'created_by.twitter_handle',
                    'created_by.avatar',
                    'created_by.avatar.id',
                    'created_by.avatar.filename_disk',
                    'created_by.avatar.title',
                    'created_by.avatar.filesize',

                    'featured_image.*',
                ]
            });

            // Transform featured_image
            if (item.featured_image && typeof item.featured_image === 'object' && item.featured_image.id) {
                item.featured_image.url = `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}`;
                item.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}?width=400&height=300&fit=cover`;
            }

            // Flatten M2M relations
            if (item.countries && Array.isArray(item.countries)) {
                item.countries = item.countries.map(c => c.countries_id).filter(Boolean);
            }
            if (item.regions && Array.isArray(item.regions)) {
                item.regions = item.regions.map(r => r.regions_id).filter(Boolean);
            }
            if (item.sectors && Array.isArray(item.sectors)) {
                item.sectors = item.sectors.map(t => t.sectors_id).filter(Boolean);
            }
            // if (item.related_projects && Array.isArray(item.related_projects)) {
            //     item.related_projects = item.related_projects.map(t => t.projects_id).filter(Boolean);
            // }

            // Handle favorites
            const { is_favorited, favorite_id } = accountability?.user
                ? await getFavoriteStatus({
                    itemId,
                    collection: 'main_news',
                    userId: accountability.user,
                    schema,
                    accountability,
                    ItemsService
                })
                : { is_favorited: false, favorite_id: null };

            const itemWithFavorite = {
                ...item,
                is_favorited,
                favorite_id,
                authenticated: !!accountability?.user
            };

            return res.json({
                data: itemWithFavorite
            });
        } catch (error) {
            console.error('Project by ID error:', error);
            next(error);
        }
    });

    router.get('/public/recent', async (req, res, next) => {
        try {
            const newsService = new ItemsService('main_news', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent news with minimal fields
            const result = await newsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'summary',
                    'content',
                    'is_free_news',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                ],
                limit: limit,
                sort: ['-date_created'],
                filter: {
                    status: { _eq: 'published' }
                }
            });

            const news = result.data || result;

            // Transform news to include full asset URLs
            const transformedNews = news.map(item => {
                if (item.featured_image && typeof item.featured_image === 'object' && item.featured_image.id) {
                    item.featured_image = {
                        id: item.featured_image.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}?width=400&height=300&fit=cover`,
                        title: item.featured_image.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    summary: item.summary,
                    is_free_news: item.is_free_news,
                    comments_count: item.comments_count,
                    featured_image: item.featured_image
                };
            });

            res.json({
                data: transformedNews,
                meta: {
                    total: transformedNews.length
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/public/trending', async (req, res, next) => {
        try {
            const newsService = new ItemsService('main_news', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent news with minimal fields
            const result = await newsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'summary',
                    'content',
                    'is_free_news',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                ],
                limit: limit,
                sort: ['-date_created'],
                filter: {
                    status: { _eq: 'published' },
                    is_trending: { _eq: true }
                }
            });

            const news = result.data || result;

            // Transform news to include full asset URLs
            const transformedNews = news.map(item => {
                if (item.featured_image && typeof item.featured_image === 'object' && item.featured_image.id) {
                    item.featured_image = {
                        id: item.featured_image.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}?width=400&height=300&fit=cover`,
                        title: item.featured_image.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    summary: item.summary,
                    is_free_news: item.is_free_news,

                    comments_count: item.comments_count,
                    featured_image: item.featured_image
                };
            });

            res.json({
                data: transformedNews,
                meta: {
                    total: news.length
                }
            });
        } catch (error) {
            console.log("trending error: ", error)
            next(error);
        }
    });

    router.get('/public/free', async (req, res, next) => {
        try {
            const newsService = new ItemsService('main_news', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent news with minimal fields
            const result = await newsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'summary',
                    'content',
                    'is_free_news',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                ],
                limit: limit,
                sort: ['-date_created'],
                filter: {
                    status: { _eq: 'published' },
                    is_free_news: { _eq: true }
                }
            });

            const news = result.data || result;

            // Transform news to include full asset URLs
            const transformedNews = news.map(item => {
                if (item.featured_image && typeof item.featured_image === 'object' && item.featured_image.id) {
                    item.featured_image = {
                        id: item.featured_image.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}?width=400&height=300&fit=cover`,
                        title: item.featured_image.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    is_free_news: item.is_free_news,
                    summary: item.summary,
                    comments_count: item.comments_count,
                    featured_image: item.featured_image
                };
            });

            res.json({
                data: transformedNews,
                meta: {
                    total: news.length
                }
            });
        } catch (error) {
            console.log("free error: ", error)
            next(error);
        }
    });

}