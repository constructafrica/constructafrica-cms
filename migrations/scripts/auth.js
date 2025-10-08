const { uploadImage } = require('../helpers/upload-image.js');
// getDirectus().then(() => console.log('Success')).catch(console.error);

uploadImage('test-id', 'test.jpg', 'test_image').then(console.log).catch(console.error);