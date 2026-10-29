import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}

export const paginate = (q: PageQuery) => ({
  skip: (q.page - 1) * q.limit,
  take: q.limit,
});

export const paged = <T>(items: T[], total: number, q: PageQuery) => ({
  items,
  total,
  page: q.page,
  limit: q.limit,
});
