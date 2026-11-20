// Konec odeslání: uvolní zámek; při plné dávce nebo izolaci vadné položky hned pokračuje další dávkou.
flow.set(`busy_${msg.batch.kind}`, 0);
return msg.more ? { payload: msg.batch.kind } : null;
