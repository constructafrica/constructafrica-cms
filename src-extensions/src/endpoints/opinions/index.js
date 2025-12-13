import {addFavoritesStatus, getFavoriteStatus} from "../../helpers/index.js";

export default (router, { services, database, getSchema}) => {
    const {ItemsService} = services;

    router.get('/', async (req, res, next) => {
        try {
            const { accountability } = req;
            const schema = await getSchema();
            const newsService = new ItemsService('experts_analysts', {
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
                const totalResult = await knex('experts_analysts').count('* as count');
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
                    'content',
                    'date_created',
                    'photo',
                    'photo.id',
                    'photo.filename_disk',
                    'photo.title',
                    'photo.filesize',
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

                // Transform photo
                if (item.photo) {
                    if (typeof item.photo === 'object' && item.photo.id) {
                        item.photo.url = `${process.env.PUBLIC_URL}/assets/${item.photo.id}`;
                        item.photo.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${item.photo.id}?width=400&height=300&fit=cover`;
                    }
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

                return item;
            });

            // Add favorites status
            return res.json({
                data: transformedNews,
                meta: meta
            });

        } catch (error) {
            console.error("News error:", error);
            next(error);
        }
    });

    router.get('/:id', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { accountability } = req;
            const itemId = req.params.id;

            const newsService = new ItemsService('experts_analysts', {
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

                    'created_by.id',
                    'created_by.first_name',
                    'created_by.last_name',
                    'created_by.email',
                    'created_by.avatar',
                    'created_by.avatar.id',
                    'created_by.avatar.filename_disk',
                    'created_by.avatar.title',
                    'created_by.avatar.filesize',

                    'photo.*',
                ]
            });

            // Transform photo
            if (item.photo && typeof item.photo === 'object' && item.photo.id) {
                item.photo.url = `${process.env.PUBLIC_URL}/assets/${item.photo.id}`;
                item.photo.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${item.photo.id}?width=400&height=300&fit=cover`;
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

            return res.json({
                data: item
            });
        } catch (error) {
            console.error('Tender by ID error:', error);
            next(error);
        }
    });

    router.get('/public/recent', async (req, res, next) => {
        try {
            const newsService = new ItemsService('experts_analysts', {
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
                    'photo.id',
                    'photo.filename_disk',
                    'photo.title',
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
                if (item.photo && typeof item.photo === 'object' && item.photo.id) {
                    item.photo = {
                        id: item.photo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.photo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.photo.id}?width=400&height=300&fit=cover`,
                        title: item.photo.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    summary: item.summary,
                    comments_count: item.comments_count,
                    photo: item.photo
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

}