export default (router, { services, exceptions }) => {
    router.get('/', (req, res) => {
        res.json({ status: 'ok', message: 'Test endpoint works!' });
    });
};