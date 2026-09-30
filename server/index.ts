import { createApiServer } from './http.js';
import { config } from './config.js';

const server = createApiServer();
server.listen(config.port, '127.0.0.1', () => {
  console.log(`解忧小屋 API listening on http://127.0.0.1:${config.port}`);
});
