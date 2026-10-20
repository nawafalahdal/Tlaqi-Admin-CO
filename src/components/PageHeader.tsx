import type { ReactNode } from "react";

/** رأسُ الصفحة الموحَّد: العنوانُ أولاً، ووصفٌ موجزٌ تحته، والإجراءُ الأساسيُّ
 *  على جهة نهاية السطر. لا مسارَ تنقّلٍ إلا في الصفحات العميقة (`back`). */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="page-header">
      {back}
      <div className="page-header__row">
        <div className="min-w-0">
          <h1 className="page-header__title">{title}</h1>
          {description && <p className="page-header__desc">{description}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </div>
  );
}
