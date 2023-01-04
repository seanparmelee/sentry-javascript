import type { Breadcrumb, Scope } from '@sentry/types';

import type { InstrumentationTypeBreadcrumb } from '../types';
import type { DomHandlerData } from './handleDom';
import { handleDom } from './handleDom';
import { handleScope } from './handleScope';

export function breadcrumbHandler(type: InstrumentationTypeBreadcrumb, handlerData: unknown): Breadcrumb | null {
  if (type === 'scope') {
    return handleScope(handlerData as Scope);
  }

  return handleDom(handlerData as DomHandlerData);
}
