import * as outbox from "../../src/features/connections/model/remoteOutbox";
import * as database from "../../src/features/connections/model/remoteOutboxDatabase";
import * as bindings from "../../src/features/connections/model/sessionExecutionBinding";
import * as bindingDatabase from "../../src/features/connections/model/hostSessionBindingDatabase";

Object.assign(window, { outboxRegression: { outbox, database, bindings, bindingDatabase } });
