// Runs before any test file is imported: AuthModule reads JWT_SECRET at import time.
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
