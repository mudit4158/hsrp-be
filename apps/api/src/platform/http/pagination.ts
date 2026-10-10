import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuery } from '@hsrp/contracts';

export class PageQueryDto extends createZodDto(PaginationQuery) {}

export function pageArgs(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function pageOf<T>(items: T[], total: number, q: { page: number; pageSize: number }) {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Pagination plus arbitrary string filters, for list endpoints with simple filters. */
export const FilteredPageQuery = PaginationQuery.catchall(z.string().optional());
export class FilteredPageQueryDto extends createZodDto(FilteredPageQuery) {}
