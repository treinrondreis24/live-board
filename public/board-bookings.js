/* Shared by the live display and the visual preview. No booking details beyond
   the internal Treinrondreis number are placed on the public board. */
function bookingBadgesHtml(numbers){
 const safe=[...new Set((numbers||[]).filter(n=>/^\d{1,8}A$/.test(n)))];
 if(!safe.length)return '';
 return '<div class="board-bookings" aria-label="Boekingen via FloRA">'+safe.map(n=>'<span class="booking-badge">'+n+'</span>').join('')+'<span class="booking-badge booking-more" hidden></span></div>';
}
function fitBookingBadges(root=document){
 root.querySelectorAll('.board-bookings').forEach(line=>{
  const badges=[...line.querySelectorAll('.booking-badge:not(.booking-more)')],more=line.querySelector('.booking-more');
  badges.forEach(b=>b.hidden=false);more.hidden=true;
  if(!line.clientWidth)return;
  const style=getComputedStyle(line),gap=parseFloat(style.columnGap)||0,available=line.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
  const widths=badges.map(b=>b.getBoundingClientRect().width);
  let count=badges.length,total=widths.reduce((a,b)=>a+b,0)+gap*Math.max(0,count-1);
  if(total<=available)return;
  more.hidden=false;
  do{count--;more.textContent='+'+(badges.length-count)+' meer';total=widths.slice(0,count).reduce((a,b)=>a+b,0)+gap*count+more.getBoundingClientRect().width;}while(count>0&&total>available);
  badges.forEach((b,i)=>b.hidden=i>=count);
 });
}
window.addEventListener('resize',()=>fitBookingBadges());
document.fonts?.ready.then(()=>fitBookingBadges());
