# Quack Table

Explore Parquet and CSV files with DuckDB SQL (VSCode Extension)

## Introduction

Quack Table is a VSCode extension that provides a preview of and SQL query
execution against Apache Parquet and CSV files. Under the hood, SQL queries are executed
by [DuckDB](https://duckdb.org/), which implements efficient partial reading and
parallel query processing.

![Demonstration of Quack Table against iris.parquet](./docs/iris.gif)

## Quick Start

1. Install the Quack Table extension from the marketplace.

2. Open a Parquet (.parquet, .pq) file or CSV (.csv) and the extension will activate.
