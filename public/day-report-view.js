export function targetDelayClass(event){return event.realtime&&!event.cancelled&&Number(event.delay)>60?'delay':'';}
