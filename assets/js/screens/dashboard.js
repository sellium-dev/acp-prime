// Paleta categórica validada (skill de dataviz) para el gráfico de vendedores
// — orden fijo, nunca se reciclan colores. Se salta el slot "verde" (#008300)
// porque coincide con nuestro acento (que ya significa "positivo/ganancia" en
// el resto de la app) y usarlo de nuevo como color de serie confundiría.
const VENDOR_COLORS = [ '#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767' ];
const CHART_DAYS = 14;

export function renderDashboard( main, ctx ) {
	const { supabase, org, navigateTo } = ctx;
	let stats = null;
	let chartDays = [];
	let chartVendors = [];
	let errorMsg = '';

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';

		const startOfMonth = new Date();
		startOfMonth.setDate( 1 );
		startOfMonth.setHours( 0, 0, 0, 0 );
		const startOfDay = new Date();
		startOfDay.setHours( 0, 0, 0, 0 );
		const chartStart = new Date();
		chartStart.setDate( chartStart.getDate() - ( CHART_DAYS - 1 ) );
		chartStart.setHours( 0, 0, 0, 0 );
		const earliestNeeded = chartStart < startOfMonth ? chartStart : startOfMonth;

		const [ variantsRes, salesRes, expensesRes, membersRes ] = await Promise.all( [
			supabase.from( 'product_variants' ).select( 'cost, price, stock_quantity' ).eq( 'organization_id', org.id ),
			supabase
				.from( 'sales' )
				.select( 'created_at, vendor_id, sale_items ( quantity, unit_price, unit_cost )' )
				.eq( 'organization_id', org.id )
				.gte( 'created_at', earliestNeeded.toISOString() ),
			supabase
				.from( 'expenses' )
				.select( 'amount' )
				.eq( 'organization_id', org.id )
				.gte( 'expense_date', ymd( startOfMonth ) ),
			supabase.from( 'memberships' ).select( 'user_id, full_name' ).eq( 'organization_id', org.id ),
		] );

		if ( variantsRes.error || salesRes.error || expensesRes.error ) {
			errorMsg = 'No se pudo cargar el Dashboard: ' + ( variantsRes.error || salesRes.error || expensesRes.error ).message;
			draw();
			return;
		}

		let invested = 0;
		let potentialProfit = 0;
		( variantsRes.data || [] ).forEach( ( v ) => {
			invested += v.cost * v.stock_quantity;
			potentialProfit += ( v.price - v.cost ) * v.stock_quantity;
		} );

		const memberNames = new Map( ( membersRes.data || [] ).map( ( m ) => [ m.user_id, m.full_name ] ) );

		let todaySold = 0;
		let todayProfit = 0;
		let monthSold = 0;
		let monthProfit = 0;
		const dayVendorQty = new Map(); // "YYYY-MM-DD|vendorId" -> qty

		( salesRes.data || [] ).forEach( ( s ) => {
			const saleDate = new Date( s.created_at );
			const isToday = saleDate >= startOfDay;
			const isThisMonth = saleDate >= startOfMonth;
			const dayKey = ymd( saleDate );

			( s.sale_items || [] ).forEach( ( it ) => {
				const sold = it.unit_price * it.quantity;
				const profit = ( it.unit_price - it.unit_cost ) * it.quantity;
				if ( isThisMonth ) {
					monthSold += sold;
					monthProfit += profit;
				}
				if ( isToday ) {
					todaySold += sold;
					todayProfit += profit;
				}
				if ( saleDate >= chartStart ) {
					const key = dayKey + '|' + s.vendor_id;
					dayVendorQty.set( key, ( dayVendorQty.get( key ) || 0 ) + it.quantity );
				}
			} );
		} );

		const monthExpenses = ( expensesRes.data || [] ).reduce( ( sum, e ) => sum + Number( e.amount ), 0 );

		stats = {
			invested,
			potentialProfit,
			todaySold,
			todayProfit,
			monthSold,
			monthProfit,
			monthExpenses,
			netMonthProfit: monthProfit - monthExpenses,
		};

		buildChartData( dayVendorQty, memberNames, chartStart );

		draw();
	}

	function buildChartData( dayVendorQty, memberNames, chartStart ) {
		const vendorIdsPresent = new Set();
		dayVendorQty.forEach( ( qty, key ) => vendorIdsPresent.add( key.split( '|' )[ 1 ] ) );

		chartVendors = Array.from( vendorIdsPresent )
			.map( ( id ) => ( { id, name: memberNames.get( id ) || 'Ex-usuario' } ) )
			.sort( ( a, b ) => a.name.localeCompare( b.name ) )
			.slice( 0, VENDOR_COLORS.length )
			.map( ( v, i ) => ( { ...v, color: VENDOR_COLORS[ i ] } ) );

		const days = [];
		for ( let i = 0; i < CHART_DAYS; i++ ) {
			const d = new Date( chartStart );
			d.setDate( d.getDate() + i );
			const key = ymd( d );
			const segments = chartVendors
				.map( ( v ) => ( { vendor: v, qty: dayVendorQty.get( key + '|' + v.id ) || 0 } ) )
				.filter( ( s ) => s.qty > 0 );
			const total = segments.reduce( ( sum, s ) => sum + s.qty, 0 );
			days.push( { label: date_i18n( d ), total, segments } );
		}
		chartDays = days;
	}

	function draw() {
		if ( ! stats ) {
			main.innerHTML = errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '<div class="acp-empty-state">Cargando…</div>';
			return;
		}

		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Dashboard</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Inventario actual</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ statCard( 'Monto invertido', money( stats.invested ), 'Costo de todo tu stock actual — click para ver el detalle', 'productos' ) }
				${ statCard( 'Ganancia potencial', money( stats.potentialProfit ), 'Si vendes todo el stock actual a precio de lista', 'productos' ) }
			</div>

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Ventas</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ splitStatCard( 'Ventas de hoy', stats.todaySold, stats.todayProfit, 'ventas', { range: 'hoy' } ) }
				${ splitStatCard( 'Ventas del mes', stats.monthSold, stats.monthProfit, 'ventas', { range: 'mes' } ) }
			</div>

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Gastos y ganancia neta (este mes)</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ statCard( 'Gastos del mes', money( stats.monthExpenses ), 'Click para ver o registrar gastos', 'gastos' ) }
				${ statCard(
					'Ganancia neta del mes',
					money( stats.netMonthProfit ),
					'Utilidad de ventas menos gastos',
					'gastos',
					null,
					stats.netMonthProfit >= 0 ? 'oklch(0.72 0.16 152)' : 'oklch(0.65 0.18 25)'
				) }
			</div>

			${ chartHtml() }
		`;

		main.querySelectorAll( '[data-goto]' ).forEach( ( el ) => {
			el.addEventListener( 'click', () => {
				const params = el.dataset.params ? JSON.parse( el.dataset.params ) : null;
				navigateTo( el.dataset.goto, params );
			} );
		} );
	}

	function statCard( label, value, hint, goto, params, color ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;cursor:pointer;transition:border-color 0.15s ease" class="acp-kpi-card" data-goto="${ goto }" ${ params ? `data-params='${ JSON.stringify( params ) }'` : '' }>
				<div style="font-size:13px;color:var(--text-muted);font-weight:600;margin-bottom:10px">${ esc( label ) }</div>
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em${ color ? `;color:${ color }` : '' }">${ value }</div>
				${ hint ? `<div style="font-size:11px;color:var(--text-faint2, var(--text-muted));margin-top:6px">${ esc( hint ) }</div>` : '' }
			</div>
		`;
	}

	function splitStatCard( label, sold, profit, goto, params ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;cursor:pointer" class="acp-kpi-card" data-goto="${ goto }" data-params='${ JSON.stringify( params ) }'>
				<div style="font-size:13px;color:var(--text-muted);font-weight:600;margin-bottom:12px">${ esc( label ) }</div>
				<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
					<span style="font-size:12px;color:var(--text-muted)">Vendido</span>
					<span style="font-size:18px;font-weight:800">${ money( sold ) }</span>
				</div>
				<div style="display:flex;justify-content:space-between;align-items:baseline">
					<span style="font-size:12px;color:var(--text-muted)">Utilidad</span>
					<span style="font-size:15px;font-weight:700;color:oklch(0.72 0.16 152)">${ money( profit ) }</span>
				</div>
			</div>
		`;
	}

	function chartHtml() {
		const maxTotal = Math.max( 1, ...chartDays.map( ( d ) => d.total ) );

		return `
			<div class="acp-viz-root">
				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px">
					<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
						<div style="font-size:15px;font-weight:700">Artículos vendidos por día</div>
						<div style="font-size:12px;color:var(--text-faint2, var(--text-muted))">Últimos ${ CHART_DAYS } días</div>
					</div>
					${
						0 === chartVendors.length
							? '<div style="font-size:13px;color:var(--text-muted);padding:20px 0">Todavía no hay ventas suficientes para mostrar el gráfico.</div>'
							: `
						<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
							${ chartVendors
								.map(
									( v ) => `
								<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2, var(--text))">
									<span style="width:10px;height:10px;border-radius:2px;background:${ v.color };display:inline-block"></span>${ esc( v.name ) }
								</div>
							`
								)
								.join( '' ) }
						</div>
						<div style="display:flex;align-items:flex-end;gap:6px;height:160px">
							${ chartDays.map( ( d ) => dayBarHtml( d, maxTotal ) ).join( '' ) }
						</div>
					`
					}
				</div>
			</div>
		`;
	}

	function dayBarHtml( day, maxTotal ) {
		const heightPct = 0 === day.total ? 0 : Math.max( 4, Math.round( ( day.total / maxTotal ) * 100 ) );
		return `
			<div class="acp-chart-day" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
				<div style="width:100%;max-width:24px;height:${ heightPct }%;display:flex;flex-direction:column;justify-content:flex-end">
					${ day.segments
						.map( ( seg, i ) => {
							const segPct = 0 === day.total ? 0 : ( seg.qty / day.total ) * 100;
							const isFirst = 0 === i;
							return `
							<div class="acp-chart-segment" data-tooltip="${ escAttr( seg.vendor.name + ': ' + seg.qty ) }"
								style="height:${ segPct }%;background:${ seg.vendor.color };${ isFirst ? 'border-radius:4px 4px 0 0;' : '' }${ i < day.segments.length - 1 ? 'margin-bottom:2px;' : '' }">
							</div>
						`;
						} )
						.join( '' ) }
				</div>
				<div class="acp-chart-daylabel" style="font-size:10px;color:var(--text-faint2, var(--text-muted));margin-top:8px;white-space:nowrap">${ esc( day.label ) }</div>
			</div>
		`;
	}
}

function ymd( date ) {
	return date.toISOString().slice( 0, 10 );
}

function date_i18n( date ) {
	return date.toLocaleDateString( 'es-CL', { day: '2-digit', month: '2-digit' } );
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}

function escAttr( val ) {
	return esc( String( val ?? '' ) );
}
