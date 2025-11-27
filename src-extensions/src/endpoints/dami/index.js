export default (router, { services, exceptions, getSchema}) => {
    const {ItemsService, AssetsService} = services;
    const {ServiceUnavailableException} = exceptions;

    router.get('/', (req, res) => {
        res.json({ status: 'ok', message: 'Test endpoint works!' });
    });
};