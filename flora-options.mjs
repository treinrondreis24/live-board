// Quotation options expire automatically; they are not confirmed reservations.
export const nsOption=m=>/\boptieboeking\b/i.test(m.subject||'')&&(/nsinternational|ns@treinrondreis/i.test(m.from||'')||/boekingscode:/i.test(m.subject||''));
