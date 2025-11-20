export default (router, { services, exceptions, getSchema}) => {
    const {ItemsService, AssetsService} = services;
    const {ServiceUnavailableException} = exceptions;

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
                    'comments_count',
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
                    'comments_count',
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
                    'comments_count',
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
            console.log("trending error: ", error)
            next(error);
        }
    });

}