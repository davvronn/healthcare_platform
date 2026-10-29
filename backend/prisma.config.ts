import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Direct (or session-pooler) connection, used by `prisma migrate`.
    url: process.env.DIRECT_URL,
  },
});
