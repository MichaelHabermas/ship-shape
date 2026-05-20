export function passed(name, summary, data = {}, claims = []) {
  return { name, status: 'passed', summary, data, claims };
}

export function failed(name, summary, data = {}, claims = []) {
  return { name, status: 'failed', summary, data, claims };
}

export function notMeasured(name, summary, data = {}, claims = []) {
  return { name, status: 'not_measured', summary, data, claims };
}

export async function optionalCollector(name, prerequisiteSummary, predicate, collect) {
  const ready = await predicate();
  if (!ready) {
    return notMeasured(name, prerequisiteSummary, {}, [
      {
        id: `${name}.available`,
        status: 'not_measured',
        statement: prerequisiteSummary,
      },
    ]);
  }
  return collect();
}
