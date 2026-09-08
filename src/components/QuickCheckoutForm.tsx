import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { CreditCard, Loader2, CheckCircle2 } from 'lucide-react';
import { useCart } from '../context/CartContext';

export default function QuickCheckoutForm({ product, qty }: { product: any, qty: number }) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const { clearCart } = useCart();
  
  const getCleanPrice = (priceStr: string | number) => {
    if (!priceStr) return 0;
    const cleaned = String(priceStr).replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    city: '',
    address: ''
  });
  
  const [cities, setCities] = useState<any[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/cities')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.cities) {
          setCities(data.cities);
          
          if (data.cities.length > 0) {
            const firstCity = data.cities[0];
            setFormData(prev => ({ ...prev, city: firstCity.name }));
            setShippingCost(Number(firstCity.price_mad) || 0);
          }
        }
      })
      .catch(err => console.error('Failed to fetch cities', err));
  }, []);

  const handleCityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cityName = e.target.value;
    setFormData({ ...formData, city: cityName });
    const selectedCity = cities.find(c => c.name === cityName);
    if (selectedCity) {
      setShippingCost(Number(selectedCity.price_mad) || 0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.phone || !formData.city || !formData.address) {
      setError(isAr ? 'المرجوا ملء جميع الحقول' : 'Please fill all fields');
      return;
    }

    const trimmedAddress = (formData.address || '').trim();
    if (trimmedAddress.length < 20) {
      setError(
        isAr
          ? 'يرجى كتابة عنوان مفصل (20 حرفاً على الأقل) لضمان دقة التوصيل.'
          : 'Please enter a detailed delivery address (at least 20 characters).'
      );
      return;
    }
    
    setError('');
    setIsSubmitting(true);
    
    try {
      const productPrice = getCleanPrice(product.price);
      const subtotal = productPrice * qty;
      const total = subtotal + shippingCost;
      
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer: {
            ...formData,
            address: trimmedAddress,
            country: 'Morocco'
          },
          items: [{
            id: product.id || product.product_nbr,
            name: product.name,
            price: product.price,
            quantity: qty,
            image: product.image
          }],
          shippingCost,
          total: total,
          discountValue: 0
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        setIsSuccess(true);
        clearCart();
      } else {
        setError(data.message || (isAr ? 'حدث خطأ أثناء معالجة الطلب' : 'Failed to process order'));
      }
    } catch (err) {
      setError(isAr ? 'حدث خطأ في الاتصال' : 'Connection error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-4">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-bold text-green-900">
          {isAr ? 'تم استلام طلبك بنجاح!' : 'Order Received Successfully!'}
        </h3>
        <p className="text-green-700 text-sm">
          {isAr ? 'سنتصل بك قريباً لتأكيد الطلب.' : 'We will contact you shortly to confirm your order.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#f4f7f5]/50 border border-[#2c5836]/10 rounded-[16px] p-5 shadow-inner mt-6 mb-8 relative overflow-hidden">
      <h3 className="text-[13px] font-black text-gray-900 mb-4 flex items-center justify-center gap-2 uppercase tracking-widest text-center">
        <CreditCard className="w-4 h-4 text-[#2c5836]" />
        {isAr ? 'اطلب الآن و ادفع عند الاستلام' : 'Order Now, Pay on Delivery'}
      </h3>
      
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 border border-red-100">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[10px] font-bold text-gray-700 mb-1.5 uppercase tracking-widest">
            {isAr ? 'الاسم الكامل' : 'Full Name'}
          </label>
          <input
            type="text"
            required
            value={formData.fullName}
            onChange={e => setFormData({...formData, fullName: e.target.value})}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2c5836]/50 transition-all text-sm"
            placeholder={isAr ? 'الاسم الكامل' : 'Full Name'}
          />
        </div>
        
        <div>
          <label className="block text-[10px] font-bold text-gray-700 mb-1.5 uppercase tracking-widest">
            {isAr ? 'رقم الهاتف' : 'Phone Number'}
          </label>
          <input
            type="tel"
            required
            dir="ltr"
            value={formData.phone}
            onChange={e => setFormData({...formData, phone: e.target.value})}
            className={`w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2c5836]/50 transition-all text-sm ${isAr ? 'text-right' : 'text-left'}`}
            placeholder="06 XX XX XX XX"
          />
        </div>
        
        <div>
          <label className="block text-[10px] font-bold text-gray-700 mb-1.5 uppercase tracking-widest">
            {isAr ? 'المدينة' : 'City'}
          </label>
          <select
            required
            value={formData.city}
            onChange={handleCityChange}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2c5836]/50 transition-all text-sm"
          >
            <option value="" disabled>{isAr ? 'اختر مدينتك' : 'Select your city'}</option>
            {cities.map((city, idx) => (
              <option key={idx} value={city.name}>
                {isAr ? city.translation : city.name}
              </option>
            ))}
          </select>
        </div>
        
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="block text-[10px] font-bold text-gray-700 uppercase tracking-widest">
              {isAr ? 'العنوان' : 'Address'}
            </label>
            <span className={`text-[10px] font-medium transition-colors ${
              formData.address.trim().length >= 20 ? 'text-emerald-600 font-bold' : 'text-gray-400'
            }`}>
              {formData.address.trim().length} / 20 {isAr ? 'حرف كحد أدنى' : 'chars min'}
            </span>
          </div>
          <textarea
            required
            rows={2}
            value={formData.address}
            onChange={e => setFormData({...formData, address: e.target.value})}
            className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 transition-all text-sm resize-none ${
              formData.address.trim().length > 0 && formData.address.trim().length < 20
                ? 'border-amber-400 focus:ring-amber-400/50'
                : 'border-gray-200 focus:ring-[#2c5836]/50'
            }`}
            placeholder={isAr ? 'العنوان بالتفصيل (اسم الشارع، الحي، رقم المنزل... 20 حرفاً على الأقل)' : 'Detailed full address (at least 20 characters)'}
          />
        </div>
        
        <div className="pt-4 border-t border-black/5 flex items-center justify-between">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{isAr ? 'المجموع:' : 'Total:'}</span>
          <span className="text-xl font-black text-[#d4af37]">
            {getCleanPrice(product.price) * qty + shippingCost} DH
          </span>
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-[#d4af37] hover:bg-gray-900 text-gray-900 hover:text-white py-4 rounded-xl font-black uppercase tracking-widest transition-all duration-300 flex justify-center items-center h-14 mt-2 shadow-sm"
        >
          {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (isAr ? 'تأكيد الطلب' : 'CONFIRM ORDER')}
        </button>
      </form>
    </div>
  );
}
