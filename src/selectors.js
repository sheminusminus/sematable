import { createSelector } from 'reselect';
import _ from 'lodash';

function paginate(rows, { page, pageSize }) {
  if (pageSize < 1) {
    return rows.slice(0);
  }
  const start = page * pageSize;
  return rows.slice(start, start + pageSize);
}

function filter(rows = [], filters = [], columns) {
  if (filters.length === 0) {
    return rows.slice(0);
  }

  // apply text filter across all columns
  let filteredRows = _.filter(rows, row => _.some(columns, (column) => {
    if (!column.filterable) {
      return false;
    }
    const normalized = String(_.get(row, column.key)).toLowerCase();
    return _.every(filters, f => !f.textFilter || normalized.indexOf(f.value) > -1);
  }));

  // apply value filters on taggable columns
  filteredRows = _.filter(filteredRows, row => _.every(columns, column => {
    if (!column.taggable) {
      return true;
    }
    const value = _.get(row, column.key);
    return _.every(filters, f => !f.valueFilter || f.key !== column.key || f.value === value);
  }));

  return filteredRows;
}

function sort(rows, { sortKey, direction }) {
  const cloned = rows.slice(0);
  if (!sortKey) {
    return cloned;
  }
  return cloned.sort((a, b) => {
    let sortVal = 0;
    if (_.get(a, sortKey) > _.get(b, sortKey)) {
      sortVal = 1;
    }
    if (_.get(a, sortKey) < _.get(b, sortKey)) {
      sortVal = -1;
    }
    if (direction === 'asc') {
      sortVal *= -1;
    }
    return sortVal;
  });
}

// wrapped in function as we use the same selectors for multiple tables
// if we don't wrap selectors like this, they would never memoize/cache results
// as we use it for multiple tables (each table has different state)
export default (tableName) => {
  const tableProp = (state, prop) => state.sematable[tableName] ?
    _.get(state.sematable[tableName], prop) : undefined;

  const getIsInitialized = (state) => state.sematable[tableName] !== undefined;
  const getInitialData = (state) => tableProp(state, 'initialData');
  const getFilter = (state) => tableProp(state, 'filter');
  const getColumns = (state) => tableProp(state, 'columns');
  const getPage = (state) => tableProp(state, 'page');
  const getPrimaryKey = (state) => tableProp(state, 'primaryKey');
  const getPageSize = (state) => tableProp(state, 'pageSize');
  const getUserSelection = (state) => tableProp(state, 'userSelection');
  const getSelectAll = (state) => tableProp(state, 'selectAll');
  const getSortInfo = (state) => ({
    sortKey: tableProp(state, 'sortKey'),
    direction: tableProp(state, 'direction'),
  });
  const getSelectEnabled = (state) => tableProp(state, 'configs.selectEnabled');

  const getFiltered = createSelector(
    getInitialData,
    getFilter,
    getColumns,
    (initialData, textFilter, columns) => filter(initialData, textFilter, columns)
  );

  const getFilterOptions = createSelector(
    getInitialData,
    getColumns,
    (initialData, columns) => {
      const options = [];
      const columnMap = _.keyBy(columns, 'key');
      const values = {};

      // set predefined values
      columns.forEach(column => {
        if (column.taggable && column.values) {
          values[column.key] = column.values;
        }
      });

      // collect values for columns that don't have predefined values
      initialData.forEach(row => {
        columns.forEach(column => {
          if (!column.taggable || column.values) {
            return;
          }
          if (!values[column.key]) {
            values[column.key] = [];
          }
          const columnValues = values[column.key];
          const value = _.get(row, column.key);
          if (!columnValues.includes(value)) {
            columnValues.push(value);
          }
        });
      });

      _.forOwn(values, (columnValues, key) => {
        columnValues.forEach(value => {
          const column = columnMap[key];
          const {
            getValueTitle = () => undefined,
            getValueClassName = () => undefined,
            getValueLabel = () => {
              let labelValue = value;
              if (_.isBoolean(value)) {
                labelValue = value ? 'Yes' : 'No';
              }
              return `${column.header}:${labelValue}`;
            },
          } = column;
          const title = getValueTitle(value);
          const label = getValueLabel(value);
          const className = getValueClassName(value);
          options.push({
            key,
            label,
            value,
            title,
            className,
            valueFilter: true,
          });
        });
      });

      return options;
    }
  );

  const getPageInfo = createSelector(
    getPage,
    getPageSize,
    getFiltered,
    (page, pageSize, filtered) => {
      if (pageSize === -1) {
        // we are showing all rows
        return {
          page,
          pageSize,
          pageCount: 1,
        };
      }
      const pageCount = Math.ceil(filtered.length / pageSize);
      // When initial data changes (and therefore filtered data), we might have
      // less data than before. If that's the case the current page value might
      // be invalid. We fix that by setting it to last page.
      let validPage = page;
      if (page > pageCount - 1) {
        validPage = pageCount - 1;
      }
      return {
        page: validPage,
        pageSize,
        pageCount,
      };
    }
  );

  const getSorted = createSelector(
    getFiltered,
    getSortInfo,
    (filtered, sortInfo) => sort(filtered, sortInfo)
  );

  const getVisible = createSelector(
    getSorted,
    getPageInfo,
    (sorted, pageInfo) => paginate(sorted, pageInfo)
  );

  const getSelectedRows = createSelector(
    getFiltered,
    getColumns,
    getUserSelection,
    getSelectAll,
    getPrimaryKey,
    getSelectEnabled,
    (filtered, columns, userSelection, selectAll, primaryKey, selectEnabled) => {
      const includesKey = (row) => _.includes(userSelection, _.get(row, primaryKey));

      if (selectAll) {
        let selectable = filtered;
        // if not all rows are selectable, apply selectEnabled function to filter selectable
        if (selectEnabled) {
          selectable = _.filter(selectable, selectEnabled);
        }
        if (_.isEmpty(userSelection)) {
          return selectable;
        }
        // when select all is enabled, userSelection acts as "not selected" rows
        return _.reject(selectable, includesKey);
      }

      // when select all is not enabled, userSelection acts as "selected" rows
      return _.filter(filtered, includesKey);
    }
  );

  return {
    getInitialData,
    getIsInitialized,
    getFilter,
    getColumns,
    getSortInfo,
    getPageInfo,
    getVisible,
    getSelectedRows,
    getSelectAll,
    getPrimaryKey,
    getFilterOptions,
  };
};
