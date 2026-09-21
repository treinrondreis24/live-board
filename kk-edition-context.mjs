import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const testEdition=()=>context.getStore()||null;
export const withTestEdition=(config,work)=>context.run(config,work);
export const sessionCookie=()=>testEdition()?'kk_test_session':'kk_session';
export function testLinks(text){return text.replace(/\/(kilometerkampioen|treinhuis|wachtwoord-herstellen)(?=\/|[?#"'`\s]|$|\.js)/g,'/$1-test');}
