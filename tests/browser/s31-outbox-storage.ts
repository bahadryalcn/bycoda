import * as outbox from "../../src/features/connections/model/remoteOutbox";
import * as database from "../../src/features/connections/model/remoteOutboxDatabase";

Object.assign(window, { outboxRegression: { outbox, database } });
